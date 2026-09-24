-- Rodada 35 · Resolution Desk 2.3.0
ALTER TABLE reconciliation_center
  ADD COLUMN IF NOT EXISTS cases JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE deployment_state SET release_version='2.3.0', updated_at=NOW() WHERE id=1;
