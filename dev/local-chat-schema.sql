CREATE TABLE IF NOT EXISTS users (
  employee_id text PRIMARY KEY, name text NOT NULL, grade text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '', bu text NOT NULL DEFAULT '', avatar text NOT NULL DEFAULT '',
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS friends (
  owner_id text NOT NULL REFERENCES users(employee_id), friend_id text NOT NULL REFERENCES users(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (owner_id, friend_id)
);
CREATE TABLE IF NOT EXISTS chat_rooms (
  id serial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('dm','group')), name text NOT NULL DEFAULT '',
  dm_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_members (
  room_id integer NOT NULL REFERENCES chat_rooms(id), user_id text NOT NULL REFERENCES users(employee_id),
  active boolean NOT NULL DEFAULT true, hidden boolean NOT NULL DEFAULT false, last_read integer NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id,user_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id serial PRIMARY KEY, room_id integer NOT NULL REFERENCES chat_rooms(id), sender_id text NOT NULL REFERENCES users(employee_id),
  kind text NOT NULL DEFAULT 'text', body text NOT NULL, client_id text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id,sender_id,client_id)
);
CREATE INDEX IF NOT EXISTS chat_history ON chat_messages (room_id,id DESC);
CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members (user_id,active,hidden);
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_no text NOT NULL DEFAULT '';
ALTER TABLE users ALTER COLUMN last_seen DROP NOT NULL;
