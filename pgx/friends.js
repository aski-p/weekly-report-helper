// Private server injects its query function and account-scoped socket delivery.
export function createFriendOperations({ query, notify }) {
  const id = (value) => value == null ? '' : String(value).trim();
  const invalid = (message) => Object.assign(new Error(message), { code: 'BAD_REQUEST' });
  const list = async (owner) => (await query('SELECT friend_id FROM friends WHERE owner_id=$1 ORDER BY created_at,friend_id', [owner])).map((r) => String(r.friend_id));
  const publish = async (owner) => {
    const ids = await list(owner);
    notify([owner], { ev: 'friends', friends: ids });
    return ids;
  };
  return {
    friends: ({ me }) => list(id(me.id)),
    async addFriend({ me }, { userId }) {
      const owner = id(me.id), target = id(userId);
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(target) || target === owner || target === 'qwen-bot') throw invalid('친구로 등록할 동료를 선택하세요');
      const [found] = await query('SELECT 1 FROM users WHERE employee_id=$1', [target]);
      if (!found) throw invalid('직원 검색에서 동료를 먼저 선택하세요');
      await query('INSERT INTO friends (owner_id,friend_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [owner,target]);
      return publish(owner);
    },
    async removeFriend({ me }, { userId }) {
      const owner = id(me.id), target = id(userId);
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(target)) throw invalid('친구를 선택하세요');
      await query('DELETE FROM friends WHERE owner_id=$1 AND friend_id=$2', [owner,target]);
      return publish(owner);
    },
  };
}
