"""Audio speaker grouping with meeting-scoped encrypted continuation state.

The private STT host supplies its state key. No audio or speaker vectors are
written to this module's filesystem. A/B labels are local to one meeting.
"""
import base64
import json
import os
import zlib

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MODEL = 'microsoft/wavlm-base-plus-sv'
REVISION = 'feb593a6c23c1cc3d9510425c29b0a14d2b07b1e'
MAX_SPEAKERS = 26


def unit(vector):
    v = np.asarray(vector, dtype=np.float32)
    return v / max(float(np.linalg.norm(v)), 1e-8)


def letter(index):
    return chr(65 + index)


class StateCodec:
    def __init__(self, key):
        self.aes = AESGCM(key)

    def load(self, token, session):
        if not token:
            return []
        if not session or len(token) > 64000:
            raise ValueError('화자 연속 정보를 확인하지 못했습니다')
        try:
            raw = base64.urlsafe_b64decode(token)
            plain = self.aes.decrypt(raw[:12], raw[12:], session.encode())
            d = json.loads(zlib.decompress(plain, bufsize=64000))
            if d['version'] != 1 or d['model'] != REVISION or len(d['profiles']) > MAX_SPEAKERS:
                raise ValueError()
            profiles = []
            for p in d['profiles']:
                v = np.frombuffer(base64.b64decode(p['v']), dtype=np.float16).astype(np.float32)
                if v.shape != (512,) or not np.isfinite(v).all() or p['id'] != letter(len(profiles)):
                    raise ValueError()
                profiles.append({'id': p['id'], 'vector': unit(v), 'count': min(200, max(1, int(p['n'])))})
            return profiles
        except Exception as e:
            raise ValueError('화자 연속 정보를 읽지 못했습니다. 이전 회의의 정보인지 확인하세요.') from e

    def dump(self, profiles, session):
        if not session:
            return ''
        d = {'version': 1, 'model': REVISION, 'profiles': [
            {'id': p['id'], 'v': base64.b64encode(p['vector'].astype(np.float16).tobytes()).decode(), 'n': p['count']} for p in profiles]}
        nonce = os.urandom(12)
        return base64.urlsafe_b64encode(nonce + self.aes.encrypt(nonce, zlib.compress(json.dumps(d).encode()), session.encode())).decode()


def cluster_vectors(vectors, profiles, threshold=0.86):
    """Do not invent a named identity; group acoustic vectors within this meeting."""
    known = len(profiles)
    centers = [{'id': p['id'], 'vector': p['vector'].copy(), 'count': p['count'], 'support': 0} for p in profiles]
    assignments = []
    for vector in vectors:
        if vector is None:
            assignments.append(None)
            continue
        scores = [float(np.dot(vector, p['vector'])) for p in centers]
        best = int(np.argmax(scores)) if scores else -1
        if best < 0 or scores[best] < threshold:
            if len(centers) >= MAX_SPEAKERS:
                assignments.append(None)
                continue
            centers.append({'id': '', 'vector': vector.copy(), 'count': 0, 'support': 0})
            best = len(centers) - 1
        p = centers[best]
        p['vector'] = unit(p['vector'] * min(p['count'], 100) + vector)
        p['count'] = min(200, p['count'] + 1)
        p['support'] += 1
        assignments.append(best)
    # A single borderline window is not enough evidence to introduce a new person.
    kept = [i for i, p in enumerate(centers) if i < known or p['support'] >= 2]
    labels = {i: letter(n) for n, i in enumerate(kept)}
    result = [{'id': labels[i], 'vector': centers[i]['vector'], 'count': centers[i]['count']} for i in kept]
    ids = [labels.get(i, '') for i in assignments]
    for i in range(1, len(ids) - 1):
        if ids[i - 1] and ids[i - 1] == ids[i + 1] and ids[i] != ids[i - 1]:
            ids[i] = ids[i - 1]
    return ids, result


class SpeakerDiarizer:
    def __init__(self, key, device='cuda:0'):
        import torch
        from transformers import Wav2Vec2FeatureExtractor, WavLMForXVector
        self.torch = torch
        self.device = device
        self.codec = StateCodec(key)
        self.extractor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
        self.model = WavLMForXVector.from_pretrained(MODEL, revision=REVISION, local_files_only=True).to(device).eval()
        self.threshold = float(os.environ.get('SPEAKER_SIMILARITY', '0.86'))

    def analyze(self, audio, words, state='', session=''):
        profiles = self.codec.load(state, session)
        sr, stride, width = 16000, 0.8, 2.4
        duration = len(audio) / sr
        centers = np.arange(0.4, max(0.41, duration), stride)
        vectors = [None] * len(centers)
        windows, positions = [], []
        for i, center in enumerate(centers):
            lo = max(0, min(center - width / 2, duration - width))
            clip = audio[int(lo * sr):int(min(duration, lo + width) * sr)].copy()
            if len(clip) < sr or float(np.sqrt(np.mean(clip ** 2))) < 0.004:
                continue
            windows.append(clip)
            positions.append(i)
        for start in range(0, len(windows), 8):
            inputs = self.extractor(windows[start:start + 8], sampling_rate=sr, return_tensors='pt', padding=True, return_attention_mask=True)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            with self.torch.inference_mode():
                embeddings = self.torch.nn.functional.normalize(self.model(**inputs).embeddings, dim=-1).cpu().numpy()
            for i, v in enumerate(embeddings):
                vectors[positions[start + i]] = unit(v)
        ids, profiles = cluster_vectors(vectors, profiles, self.threshold)
        segments = []
        for word in words:
            text = str(word.get('text', '')).strip()
            if not text:
                continue
            stamps = word.get('timestamp') or (0, duration)
            lo = min(duration, max(0, float(stamps[0] or 0)))
            hi = min(duration, max(lo, float(stamps[1] if stamps[1] is not None else duration)))
            index = int(np.argmin(np.abs(centers - (lo + hi) / 2)))
            speaker = ids[index] if ids else ''
            if segments and segments[-1]['speaker'] == speaker and lo - segments[-1]['end'] < 1.2:
                segments[-1]['text'] += ' ' + text
                segments[-1]['end'] = hi
            else:
                segments.append({'start': round(lo, 2), 'end': round(hi, 2), 'speaker': speaker, 'text': text})
        return {'segments': segments, 'speakerState': self.codec.dump(profiles, session), 'diarization': True}
