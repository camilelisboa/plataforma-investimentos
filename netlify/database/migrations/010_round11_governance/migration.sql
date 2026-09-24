CREATE TABLE IF NOT EXISTS portfolio_governance (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  objective TEXT NOT NULL DEFAULT '',
  horizon_years NUMERIC(8,2) NOT NULL DEFAULT 10,
  review_frequency_months INTEGER NOT NULL DEFAULT 6,
  max_asset_weight_pct NUMERIC(8,4) NOT NULL DEFAULT 20,
  min_cash_pct NUMERIC(8,4) NOT NULL DEFAULT 5,
  liquidity_note TEXT NOT NULL DEFAULT '',
  principles TEXT NOT NULL DEFAULT '',
  restricted_assets TEXT NOT NULL DEFAULT '',
  stress_shocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_journal (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  decision_date DATE NOT NULL,
  category TEXT NOT NULL,
  symbol TEXT,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  trigger_note TEXT NOT NULL DEFAULT '',
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'OPEN',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_journal_portfolio_review ON decision_journal(portfolio_id, review_date);
