CREATE TABLE IF NOT EXISTS portfolio_financial_baselines (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  market_value_base NUMERIC(22,2),
  invested_value_base NUMERIC(22,2),
  contributions_base NUMERIC(22,2),
  withdrawals_base NUMERIC(22,2),
  income_base NUMERIC(22,2),
  raw_market_reference NUMERIC(22,2) NOT NULL DEFAULT 0,
  raw_invested_reference NUMERIC(22,2) NOT NULL DEFAULT 0,
  raw_contributions_reference NUMERIC(22,2) NOT NULL DEFAULT 0,
  raw_withdrawals_reference NUMERIC(22,2) NOT NULL DEFAULT 0,
  raw_income_reference NUMERIC(22,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE deployment_state SET release_version='1.2.1', updated_at=NOW() WHERE id=1;
