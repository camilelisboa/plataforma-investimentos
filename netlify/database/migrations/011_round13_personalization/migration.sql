CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  palette_key TEXT NOT NULL,
  profile_photo_data_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_preferences (user_id, palette_key)
SELECT id, CASE WHEN theme = 'lucas' THEN 'lucas-black-tie' ELSE 'camile-baby-sage' END
FROM users
ON CONFLICT (user_id) DO NOTHING;
