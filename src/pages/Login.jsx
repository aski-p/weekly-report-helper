import { useState } from 'react';
import { api, errorText } from '../api.js';
import SkinPicker from '../components/SkinPicker.jsx';

export default function Login({ onLogin, onInstall }) {
  const [employeeNo, setEmployeeNo] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!employeeNo.trim()) return setError('사번을 입력하세요.');
    if (!password) return setError('비밀번호를 입력하세요.');
    setBusy(true); setError('');
    try {
      const r = await api.login(employeeNo.trim(), password);
      if (r.mustChangePassword) { setError('OneFinger 사이트에서 비밀번호를 먼저 변경한 뒤 로그인하세요.'); return; }
      onLogin(r.me || await api.me());
    } catch (err) {
      setError(errorText(err, '로그인하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-skin"><SkinPicker /></div>
      <form className="login-sheet" onSubmit={submit} noValidate>
        <img className="login-mark" src="/icons/icon-192.png" alt="" width="56" height="56" />
        <h1>주간보고 도우미</h1>
        <p className="login-lede">이번 주 한 일을 메모로 적으면, 본부 보고 양식에 맞춰 정리해 OneFinger에 올려 드립니다.</p>

        <label className="field">
          <span>사번</span>
          <input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} autoComplete="username" inputMode="text" autoFocus />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>

        <p className="form-error" role="alert">{error}</p>
        <button className="btn primary block" disabled={busy}>{busy ? '확인하는 중…' : 'OneFinger 계정으로 로그인'}</button>

        <p className="login-foot">
          비밀번호는 이 기기에서 암호화되어 OneFinger로 바로 전달됩니다. 5회 틀리면 계정이 잠기니 주의하세요.
        </p>
      </form>
      <button className="text-link install-link" onClick={onInstall}>휴대폰·PC에 앱으로 설치하기</button>
    </main>
  );
}
