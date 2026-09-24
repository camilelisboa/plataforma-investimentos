-- Rodada 31 · Decision Review Loop
-- Os novos campos do diário vivem no JSONB existente para preservar compatibilidade com a R30.
UPDATE deployment_state SET release_version='2.0.0', updated_at=NOW() WHERE id=1;
