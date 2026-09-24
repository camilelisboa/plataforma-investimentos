CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_id BIGINT REFERENCES assets(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BUY','SELL','DEPOSIT','WITHDRAWAL')),
  trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity NUMERIC(22,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_price NUMERIC(22,8) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  fees NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_portfolio_date_idx ON transactions(portfolio_id, trade_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_asset_idx ON transactions(asset_id, trade_date DESC);

CREATE TABLE IF NOT EXISTS income_events (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_id BIGINT REFERENCES assets(id) ON DELETE SET NULL,
  income_type TEXT NOT NULL CHECK (income_type IN ('DIVIDEND','JCP','FII_INCOME','INTEREST','COUPON','OTHER')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gross_amount NUMERIC(22,2) NOT NULL CHECK (gross_amount >= 0),
  tax_amount NUMERIC(22,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS income_portfolio_date_idx ON income_events(portfolio_id, payment_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS income_asset_idx ON income_events(asset_id, payment_date DESC);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  market_value NUMERIC(22,2) NOT NULL DEFAULT 0,
  invested_value NUMERIC(22,2) NOT NULL DEFAULT 0,
  cumulative_contributions NUMERIC(22,2) NOT NULL DEFAULT 0,
  cumulative_withdrawals NUMERIC(22,2) NOT NULL DEFAULT 0,
  cumulative_income NUMERIC(22,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS snapshots_portfolio_date_idx ON portfolio_snapshots(portfolio_id, snapshot_date);

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS benchmark_symbol TEXT NOT NULL DEFAULT '^BVSP',
  ADD COLUMN IF NOT EXISTS tracking_start_date DATE;

CREATE TABLE IF NOT EXISTS watchlist (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  target_buy_price NUMERIC(22,8) CHECK (target_buy_price >= 0),
  notes TEXT,
  market_price NUMERIC(22,8) CHECK (market_price >= 0),
  market_change_pct NUMERIC(14,6),
  market_price_at TIMESTAMPTZ,
  quote_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, symbol)
);

CREATE INDEX IF NOT EXISTS watchlist_portfolio_idx ON watchlist(portfolio_id, symbol);
