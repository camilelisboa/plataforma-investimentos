ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS rebalance_tolerance_pct NUMERIC(8,4) NOT NULL DEFAULT 3.0000
    CHECK (rebalance_tolerance_pct >= 0 AND rebalance_tolerance_pct <= 20);
