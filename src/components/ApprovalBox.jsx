// 결재란: 작성 | 승인. 게시가 끝나면 승인 칸에 인주 도장이 찍힌다.
export default function ApprovalBox({ writer, approval }) {
  const stamped = approval?.ok;
  const d = stamped ? new Date(approval.at) : null;
  return (
    <table className="approval" aria-label="결재란">
      <thead>
        <tr><th scope="col">작성</th><th scope="col">승인</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><span className="signer">{writer}</span></td>
          <td>
            {stamped ? (
              <span className="stamp" key={approval.at} role="img" aria-label="승인됨">
                <span>승인</span>
              </span>
            ) : <span className="unsigned" aria-label="미승인" />}
          </td>
        </tr>
        <tr className="dates">
          <td />
          <td>{d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''}</td>
        </tr>
      </tbody>
    </table>
  );
}
