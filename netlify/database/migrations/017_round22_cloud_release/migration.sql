CREATE TABLE IF NOT EXISTS deployment_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  setup_completed_at TIMESTAMPTZ,
  release_version TEXT NOT NULL DEFAULT '1.1.0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO deployment_state (id, setup_completed_at, release_version)
SELECT 1,
       CASE WHEN EXISTS (SELECT 1 FROM users WHERE password_hash LIKE 'disabled$%') THEN NULL ELSE NOW() END,
       '1.1.0'
ON CONFLICT (id) DO UPDATE SET release_version='1.1.0', updated_at=NOW();

ALTER TABLE account_backups
  ADD COLUMN IF NOT EXISTS backup_kind TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS period_key TEXT;

DO $$ BEGIN
  ALTER TABLE account_backups ADD CONSTRAINT account_backups_kind_check CHECK (backup_kind IN ('MANUAL','AUTOMATIC'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS account_backups_auto_period_idx
  ON account_backups(user_id, period_key)
  WHERE backup_kind='AUTOMATIC' AND period_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_last_seen_idx ON sessions(user_id, last_seen_at DESC);
