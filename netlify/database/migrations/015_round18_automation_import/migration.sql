CREATE TABLE IF NOT EXISTS automation_settings (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  daily_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_quotes BOOLEAN NOT NULL DEFAULT TRUE,
  evaluate_rules BOOLEAN NOT NULL DEFAULT TRUE,
  duplicate_guard BOOLEAN NOT NULL DEFAULT TRUE,
  run_once_per_day BOOLEAN NOT NULL DEFAULT TRUE,
  stale_quote_hours INTEGER NOT NULL DEFAULT 12 CHECK (stale_quote_hours BETWEEN 1 AND 168),
  last_run_at TIMESTAMPTZ,
  last_run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL CHECK (import_type IN ('POSITIONS','TRANSACTIONS','INCOME')),
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','PARTIAL','FAILED')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  apply_to_positions BOOLEAN NOT NULL DEFAULT FALSE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_batches_portfolio_date_idx ON import_batches(portfolio_id, created_at DESC, id DESC);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id BIGINT REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_import_fingerprint_uq
  ON transactions(portfolio_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

ALTER TABLE income_events ADD COLUMN IF NOT EXISTS import_batch_id BIGINT REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE income_events ADD COLUMN IF NOT EXISTS import_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS income_import_fingerprint_uq
  ON income_events(portfolio_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;
