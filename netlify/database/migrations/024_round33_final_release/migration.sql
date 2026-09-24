-- Rodada 33 · Final Release 2.1.0
-- Rodada 32 absorvida pelo fechamento; nenhuma alteração destrutiva de dados.
UPDATE deployment_state SET release_version='2.1.0', updated_at=NOW() WHERE id=1;
