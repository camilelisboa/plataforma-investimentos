CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  login_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('camile', 'lucas')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolios (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

INSERT INTO users (login_key, display_name, password_hash, theme, must_change_password)
VALUES
  ('camile lisboa', 'Camile Lisboa', 'disabled$round22', 'camile', TRUE),
  ('lucas souto', 'Lucas Souto', 'disabled$round22', 'lucas', TRUE)
ON CONFLICT (login_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  password_hash = EXCLUDED.password_hash,
  theme = EXCLUDED.theme;

INSERT INTO portfolios (user_id, name)
SELECT id, display_name || ' — Carteira'
FROM users
WHERE login_key IN ('camile lisboa', 'lucas souto')
ON CONFLICT (user_id) DO NOTHING;
