import hashlib
import unittest
import numpy as np
from speaker_diarization import StateCodec, cluster_vectors, unit


class SpeakerTests(unittest.TestCase):
    def test_state_is_bound_to_a_meeting_and_survives_reload(self):
        key = hashlib.sha256(b'test key').digest()
        profile = {'id': 'A', 'vector': unit(np.ones(512)), 'count': 3}
        token = StateCodec(key).dump([profile], 'meeting-a')
        restored = StateCodec(key).load(token, 'meeting-a')
        self.assertEqual(restored[0]['id'], 'A')
        self.assertGreater(float(np.dot(restored[0]['vector'], profile['vector'])), .999)
        with self.assertRaises(ValueError):
            StateCodec(key).load(token, 'meeting-b')
        with self.assertRaises(ValueError):
            StateCodec(key).load(token[:-4] + 'aaaa', 'meeting-a')

    def test_new_speakers_and_returns_keep_alphabet_labels(self):
        a = unit(np.eye(512)[0])
        b = unit(np.eye(512)[1])
        ids, state = cluster_vectors([a,a,a,b,b,b,a,a], [])
        self.assertEqual(ids, ['A','A','A','B','B','B','A','A'])
        ids, _ = cluster_vectors([b,b,a,a], state)
        self.assertEqual(ids, ['B','B','A','A'])

    def test_third_speaker_keeps_c_across_chunks(self):
        a, b, c = [unit(np.eye(512)[i]) for i in range(3)]
        _, state = cluster_vectors([a,a,b,b], [])
        ids, state = cluster_vectors([c,c,c], state)
        self.assertEqual(ids, ['C','C','C'])
        ids, _ = cluster_vectors([a,a,c,c], state)
        self.assertEqual(ids, ['A','A','C','C'])

    def test_silence_and_one_ambiguous_window_are_unassigned(self):
        a = unit(np.eye(512)[0])
        ids, state = cluster_vectors([None,a,None], [])
        self.assertEqual(ids, ['','',''])
        self.assertEqual(state, [])


if __name__ == '__main__':
    unittest.main()
