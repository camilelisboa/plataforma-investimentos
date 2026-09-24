-- Rodada 34 · Conciliação & Proveniência 2.2.0
CREATE TABLE IF NOT EXISTS reconciliation_center (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  records JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
UPDATE deployment_state SET release_version='2.2.0', updated_at=NOW() WHERE id=1;
