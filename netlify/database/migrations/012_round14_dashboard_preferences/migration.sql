ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS pinned_sections JSONB NOT NULL DEFAULT '["portfolio","decision","rebalance","reports","governance","closing"]'::jsonb;
