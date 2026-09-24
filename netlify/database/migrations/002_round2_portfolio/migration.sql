CREATE TABLE IF NOT EXISTS assets (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'Outro',
  quantity NUMERIC(22,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_price NUMERIC(22,8) NOT NULL DEFAULT 0 CHECK (average_price >= 0),
  manual_price NUMERIC(22,8) CHECK (manual_price >= 0),
  target_pct NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (target_pct >= 0 AND target_pct <= 100),
  auto_quote BOOLEAN NOT NULL DEFAULT TRUE,
  market_price NUMERIC(22,8) CHECK (market_price >= 0),
  market_change_pct NUMERIC(14,6),
  market_price_at TIMESTAMPTZ,
  quote_source TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, symbol)
);

CREATE INDEX IF NOT EXISTS assets_portfolio_idx ON assets(portfolio_id);
CREATE INDEX IF NOT EXISTS assets_active_idx ON assets(portfolio_id, active);

CREATE TABLE IF NOT EXISTS allocation_targets (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  target_pct NUMERIC(8,4) NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, class_name)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_label TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_portfolio_idx ON activity_log(portfolio_id, created_at DESC);

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS last_rebalance_amount NUMERIC(22,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
