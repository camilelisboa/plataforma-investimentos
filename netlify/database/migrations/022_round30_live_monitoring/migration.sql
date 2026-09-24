-- Rodada 30 · Live Monitoring & Decision Log
CREATE TABLE IF NOT EXISTS live_monitoring_center (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
UPDATE deployment_state SET release_version='1.9.0', updated_at=NOW() WHERE id=1;
