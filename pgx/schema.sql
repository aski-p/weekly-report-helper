-- PGX personal data. Existing template rows are preserved.
CREATE TABLE IF NOT EXISTS templates (
  id text PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL,
  this_week text NOT NULL DEFAULT '', next_week text NOT NULL DEFAULT '', issue text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '', origin text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_owner ON templates (owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS meetings (
  owner_id text NOT NULL, id text NOT NULL,
  meeting_date date NOT NULL, title text NOT NULL DEFAULT '', attendees text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '', transcript text NOT NULL DEFAULT '',
  duration_sec integer NOT NULL DEFAULT 0 CHECK (duration_sec >= 0), summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS meetings_owner_date ON meetings (owner_id, meeting_date DESC, id DESC);
