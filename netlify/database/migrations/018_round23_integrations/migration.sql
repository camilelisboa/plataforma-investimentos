CREATE TABLE IF NOT EXISTS integration_settings (
  portfolio_id BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  market_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  agenda_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  benchmarks_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sync_hour_local INTEGER NOT NULL DEFAULT 7 CHECK (sync_hour_local BETWEEN 0 AND 23),
  last_sync_at TIMESTAMPTZ,
  last_sync_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO integration_settings (portfolio_id)
SELECT id FROM portfolios
ON CONFLICT (portfolio_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS integration_runs (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  trigger_kind TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_kind IN ('MANUAL','SCHEDULED')),
  status TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','PARTIAL','FAILED')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_runs_portfolio_created_idx ON integration_runs(portfolio_id, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS benchmark_observations (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  benchmark_key TEXT NOT NULL,
  observation_date DATE NOT NULL,
  value NUMERIC(20,8) NOT NULL,
  source TEXT NOT NULL DEFAULT 'brapi.dev',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, benchmark_key, observation_date)
);
CREATE INDEX IF NOT EXISTS benchmark_observations_lookup_idx ON benchmark_observations(portfolio_id, benchmark_key, observation_date DESC);

ALTER TABLE finance_calendar_events
  ADD COLUMN IF NOT EXISTS external_key TEXT,
  ADD COLUMN IF NOT EXISTS integration_source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS finance_calendar_events_external_uq
  ON finance_calendar_events(portfolio_id, external_key)
  WHERE external_key IS NOT NULL;

UPDATE deployment_state SET release_version='1.2.0', updated_at=NOW() WHERE id=1;
