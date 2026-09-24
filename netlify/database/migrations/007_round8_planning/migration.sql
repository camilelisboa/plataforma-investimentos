CREATE TABLE IF NOT EXISTS planning_settings (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  annual_return_pct NUMERIC(8,4) NOT NULL DEFAULT 8.0000 CHECK (annual_return_pct >= -100 AND annual_return_pct <= 1000),
  inflation_pct NUMERIC(8,4) NOT NULL DEFAULT 4.5000 CHECK (inflation_pct >= -50 AND inflation_pct <= 1000),
  horizon_years INTEGER NOT NULL DEFAULT 10 CHECK (horizon_years >= 1 AND horizon_years <= 60),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
