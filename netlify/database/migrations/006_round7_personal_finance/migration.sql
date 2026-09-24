CREATE TABLE IF NOT EXISTS personal_finance_profiles (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  monthly_net_income NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (monthly_net_income >= 0),
  fixed_expenses NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (fixed_expenses >= 0),
  variable_expenses NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (variable_expenses >= 0),
  other_commitments NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (other_commitments >= 0),
  emergency_reserve NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (emergency_reserve >= 0),
  debts_total NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (debts_total >= 0),
  other_investments NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (other_investments >= 0),
  real_estate_equity NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (real_estate_equity >= 0),
  other_assets NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (other_assets >= 0),
  desired_reserve_months NUMERIC(8,2) NOT NULL DEFAULT 6 CHECK (desired_reserve_months >= 0 AND desired_reserve_months <= 60),
  monthly_investment_goal NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (monthly_investment_goal >= 0),
  net_worth_goal NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (net_worth_goal >= 0),
  net_worth_goal_date DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_goals (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'OTHER' CHECK (category IN ('RESERVE','TRAVEL','PROPERTY','RETIREMENT','EDUCATION','OTHER')),
  target_amount NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  current_amount NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_date DATE,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS financial_goals_portfolio_idx ON financial_goals(portfolio_id, active, target_date);

CREATE TABLE IF NOT EXISTS monthly_finance_checkins (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  month_date DATE NOT NULL,
  income NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (income >= 0),
  expenses NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (expenses >= 0),
  invested NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (invested >= 0),
  ending_cash NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (ending_cash >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, month_date)
);
CREATE INDEX IF NOT EXISTS finance_checkins_portfolio_month_idx ON monthly_finance_checkins(portfolio_id, month_date DESC);

CREATE TABLE IF NOT EXISTS finance_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'ECONOMIC' CHECK (category IN ('ECONOMIC','CORPORATE','PERSONAL')),
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS finance_calendar_events_portfolio_date_idx ON finance_calendar_events(portfolio_id, event_date);

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS alert_change_pct NUMERIC(10,4) CHECK (alert_change_pct >= 0 AND alert_change_pct <= 100);
