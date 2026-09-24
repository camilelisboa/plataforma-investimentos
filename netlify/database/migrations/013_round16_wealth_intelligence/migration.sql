ALTER TABLE planning_settings
  ADD COLUMN IF NOT EXISTS wealth_monthly_contribution NUMERIC(16,2),
  ADD COLUMN IF NOT EXISTS passive_income_yield_pct NUMERIC(8,4) NOT NULL DEFAULT 5.0000;

ALTER TABLE planning_settings DROP CONSTRAINT IF EXISTS planning_settings_wealth_monthly_contribution_check;
ALTER TABLE planning_settings ADD CONSTRAINT planning_settings_wealth_monthly_contribution_check CHECK (wealth_monthly_contribution IS NULL OR wealth_monthly_contribution >= 0);
ALTER TABLE planning_settings DROP CONSTRAINT IF EXISTS planning_settings_passive_income_yield_pct_check;
ALTER TABLE planning_settings ADD CONSTRAINT planning_settings_passive_income_yield_pct_check CHECK (passive_income_yield_pct >= 0 AND passive_income_yield_pct <= 100);
