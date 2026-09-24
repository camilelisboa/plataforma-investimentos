-- Rodada 29 · Live Alert Center
CREATE TABLE IF NOT EXISTS live_alert_center (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  alert_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
UPDATE deployment_state SET release_version='1.8.0', updated_at=NOW() WHERE id=1;
