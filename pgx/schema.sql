-- PGX personal data. Existing template rows are preserved.
CREATE TABLE IF NOT EXISTS templates (
  id text NOT NULL, owner_id text NOT NULL, name text NOT NULL,
  this_week text NOT NULL DEFAULT '', next_week text NOT NULL DEFAULT '', issue text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '', origin text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);
-- Upgrade the original globally keyed table without deleting any rows.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='templates'::regclass AND contype='p' AND array_length(conkey,1)=1) THEN
    ALTER TABLE templates DROP CONSTRAINT templates_pkey;
    ALTER TABLE templates ADD PRIMARY KEY (owner_id,id);
  END IF;
END $$;
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

-- Speaker labels and editable names are private to each saved meeting.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS speaker_names jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS speaker_state text NOT NULL DEFAULT '';
