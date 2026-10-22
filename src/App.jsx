import { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { api, hasToken, onUnauthorized } from './api.js';
import Login from './pages/Login.jsx';
import Workspace from './pages/Workspace.jsx';
import Install from './pages/Install.jsx';
import { ToastHost, toast } from './components/Toast.jsx';

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

  useEffect(() => {
    const updateSW = registerSW({ onNeedRefresh: () => setUpdate(() => () => updateSW(true)) });
  }, []);

  useEffect(() => onUnauthorized(() => { setMe(null); toast('로그인이 만료되었습니다. 다시 로그인하세요.'); }), []);

  useEffect(() => {
    if (!hasToken()) return;
    api.me().then(setMe).catch(() => {}).finally(() => setBooting(false));
  }, []);

  let page;
  if (path.startsWith('/install')) page = <Install onBack={() => go('/')} />;
  else if (booting) page = <div className="boot" aria-busy="true" />;
  else if (!me) page = <Login onLogin={setMe} onInstall={() => go('/install')} />;
  else page = <Workspace me={me} onLogout={async () => { await api.logout().catch(() => {}); setMe(null); }} onInstall={() => go('/install')} />;

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
