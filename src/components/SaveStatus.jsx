export default function SaveStatus({ status, error, onRetry }) {
  return <p className={`view-sub${status === 'error' ? ' warn-line' : ''}`} role="status">
    {status === 'loading' ? '저장된 내용을 불러오는 중…' : status === 'pending' ? '서버에 저장 중…' : status === 'error' ? `${error} · 변경 내용은 이 기기에 보관 중입니다.` : '서버에 저장됨 · 다른 기기에서도 확인할 수 있습니다.'}
    {status === 'error' && <> <button className="text-link" onClick={onRetry}>다시 시도</button></>}
  </p>;
}
