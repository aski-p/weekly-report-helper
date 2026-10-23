import { useEffect, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import { canPrompt, isStandalone, platform, promptInstall, subscribe } from '../install.js';

const APK_URL = import.meta.env.VITE_APK_URL || '/download/weekly-report.apk';

const GUIDES = {
  android: {
    title: '안드로이드',
    steps: [
      'Chrome으로 이 페이지를 엽니다. 카카오톡 등에서 열었다면 오른쪽 위 메뉴에서 "다른 브라우저로 열기"를 누르세요.',
      '아래 "앱 설치" 버튼을 누르거나, Chrome 메뉴(⋮)에서 "앱 설치"를 고릅니다.',
      '홈 화면에 생긴 주간보고 아이콘으로 실행합니다.',
    ],
  },
  ios: {
    title: '아이폰 · 아이패드',
    steps: [
      'Safari로 이 페이지를 엽니다. 다른 앱에서 열었다면 Safari로 옮겨 주세요.',
      '화면 아래 공유 버튼(네모에서 화살표가 나오는 모양)을 누릅니다.',
      '목록을 내려 "홈 화면에 추가"를 누르고, 오른쪽 위 "추가"를 누릅니다.',
    ],
  },
  desktop: {
    title: 'PC',
    steps: [
      'Chrome 또는 Edge로 이 페이지를 엽니다.',
      '아래 "앱 설치" 버튼을 누르거나, 주소창 오른쪽의 설치 아이콘을 누릅니다.',
      '시작 메뉴나 Dock에서 주간보고 도우미를 실행합니다.',
    ],
  },
};

export default function Install({ onBack }) {
  const p = platform();
  const [tab, setTab] = useState(p.os);
  const promptable = useSyncExternalStore(subscribe, canPrompt);
  const [installed, setInstalled] = useState(isStandalone());
  const [qr, setQr] = useState('');
  const appUrl = location.origin;

  useEffect(() => {
    QRCode.toDataURL(appUrl + '/install', { margin: 1, width: 360, color: { dark: '#1d2433', light: '#ffffff' } }).then(setQr);
  }, [appUrl]);

  async function install() {
    const r = await promptInstall();
    if (r === 'accepted') setInstalled(true);
  }

  const guide = GUIDES[tab];

  return (
    <main className="install">
      <button className="text-link back" onClick={onBack}>앱으로 돌아가기</button>

      <header className="install-hero">
        <img src="/icons/icon-512.png" alt="" width="112" height="112" />
        <div>
          <h1>주간보고 도우미를 설치하세요</h1>
          <p>홈 화면에서 바로 열고, 메모는 기기에 저장됩니다. 설치해도 OneFinger 계정으로 로그인하는 건 같습니다.</p>
        </div>
      </header>

      <section className="install-primary" aria-live="polite">
        {installed ? (
          <p className="installed">이 기기에는 이미 설치되어 있습니다.</p>
        ) : (
          <div className="install-actions">
            {promptable && <button className="btn primary large" onClick={install}>앱 설치</button>}
            {p.os === 'android' && APK_URL && (
              <a className="btn ghost large" href={APK_URL}>APK 내려받기</a>
            )}
            {p.os === 'ios' && !p.safari && <p className="install-note">아이폰은 Safari에서만 설치할 수 있습니다. 이 주소를 Safari로 열어 주세요.</p>}
            {p.os === 'android' && p.inApp && <p className="install-note">앱 안의 브라우저에서는 설치가 안 됩니다. Chrome으로 열어 주세요.</p>}
            {!promptable && p.os !== 'ios' && !p.inApp && (
              <p className="install-note">설치 버튼이 보이지 않으면 브라우저 메뉴에서 "앱 설치"를 찾아 주세요.</p>
            )}
          </div>
        )}
      </section>

      <div className="install-grid">
        <section className="install-guide">
          <div className="seg" role="tablist" aria-label="기기 선택">
            {Object.entries(GUIDES).map(([k, g]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{g.title}</button>
            ))}
          </div>
          <ol className="steps">
            {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {tab === 'android' && (
            <p className="apk-line">
              {APK_URL
                ? <>회사 폰처럼 브라우저 설치가 막혀 있으면 <a href={APK_URL}>APK 파일</a>로 설치할 수 있습니다. 설치할 때 "출처를 알 수 없는 앱" 허용이 필요합니다.</>
                : 'APK 파일은 준비 중입니다. 지금은 위 방법으로 설치하면 앱과 똑같이 쓸 수 있습니다.'}
            </p>
          )}
        </section>

        {p.os === 'desktop' && (
          <section className="install-qr">
            {qr && <img src={qr} alt="휴대폰으로 이 설치 페이지를 여는 QR 코드" width="180" height="180" />}
            <p>휴대폰 카메라로 찍으면 이 페이지가 열립니다.</p>
            <code>{appUrl.replace(/^https?:\/\//, '')}/install</code>
          </section>
        )}
      </div>
    </main>
  );
}
