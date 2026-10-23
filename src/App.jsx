import { useCallback, useEffect, useState, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { api, hasToken, onUnauthorized } from './api.js';
import Login from './pages/Login.jsx';
import Workspace from './pages/Workspace.jsx';
import Install from './pages/Install.jsx';
import { ToastHost, toast } from './components/Toast.jsx';
import { startAccountSync, stopAccountSync } from './account-sync.js';
import { chat } from './chat.js';
import { isRecording } from './meetings.js';

// 아주 작은 라우터: '/' 작성, '/install' 설치 안내
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to) => { history.pushState(null, '', to); setPath(to); scrollTo(0, 0); }, []);
  return [path, go];
}

export default function App() {
  const [path, go] = usePath();
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(hasToken());
  const [update, setUpdate] = useState(null);
  const loginEpoch = useRef(0);
  const enter = async (account) => {
    const epoch=++loginEpoch.current;
    setBooting(true);
    try { await startAccountSync(account.employeeId); if(epoch===loginEpoch.current)setMe(account); }
    finally { if(epoch===loginEpoch.current)setBooting(false); }
  };

  // 새 버전은 서비스 워커가 받자마자 바로 넘겨받는다(skipWaiting).
  // 화면은 앱을 다시 열거나 다른 앱에서 돌아올 때 새로 불러온다. 녹음 중이면 끝날 때까지 미룬다.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    let pending = false;
    const hadController = !!sw.controller;
    const reload = () => { if (pending && !isRecording()) location.reload(); };
    const onChange = () => {
      if (!hadController) return; // 첫 설치
      pending = true;
      setUpdate(() => () => { if (isRecording()) toast('녹음이 끝나면 업데이트하세요.'); else location.reload(); });
    };
    let check = () => {};
    const onVisible = () => {
      if (document.hidden) return;
      reload();
      check();
    };
    sw.addEventListener('controllerchange', onChange);
    document.addEventListener('visibilitychange', onVisible);
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        check = () => reg.update().catch(() => {});
        setInterval(check, 30 * 60_000);
      },
    });
    return () => {
      sw.removeEventListener('controllerchange', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => onUnauthorized(() => { loginEpoch.current++; stopAccountSync(); chat.stop(); setMe(null); toast('로그인이 만료되었습니다. 다시 로그인하세요.'); }), []);

  useEffect(() => {
    if (!hasToken()) return;
    api.me().then(enter).catch(() => {}).finally(() => setBooting(false));
  }, []);

  let page;
  if (path.startsWith('/install')) page = <Install onBack={() => go('/')} />;
  else if (booting) page = <div className="boot" aria-busy="true" />;
  else if (!me) page = <Login onLogin={enter} onInstall={() => go('/install')} />;
  else page = <Workspace me={me} onLogout={async () => { loginEpoch.current++; stopAccountSync(); chat.stop(); await api.logout().catch(() => {}); setMe(null); }} onInstall={() => go('/install')} />;

  return (
    <>
      {page}
      {update && (
        <div className="update-bar" role="status">
          <span>새 버전이 있습니다.</span>
          <button className="btn small" onClick={update}>지금 업데이트</button>
        </div>
      )}
      <ToastHost />
    </>
  );
}
