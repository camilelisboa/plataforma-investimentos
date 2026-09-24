-- Rodada 3.1: garante que os dois acessos iniciais solicitados pelo proprietário
-- estejam sincronizados mesmo quando uma base anterior já executou a migration 001.
-- Somente hashes scrypt são armazenados; nenhuma senha em texto puro fica no projeto.

UPDATE users
SET password_hash = 'scrypt$16384$8$1$Rp3baRBmEsX+AMGtdjgy9Q==$5D1H5HN39VIqh1/FRtxD34UFZyVNQJOCTSItZjeshrHuqzg1KB3GdepKtrvKOhRiiM0crSwBCQIodVdmr/OvGQ==',
    must_change_password = TRUE
WHERE login_key = 'camile lisboa';

UPDATE users
SET password_hash = 'scrypt$16384$8$1$plLRrmMYG+mFXlWMJppDdg==$zHNyumWDv32hzDdthA7w26UZKi4NPgvaZmivenGDCB9x/mBk8J/ccNzeWMmo4cxuoxNQdC/vgzv+L/UqW+pnJA==',
    must_change_password = TRUE
WHERE login_key = 'lucas souto';

DELETE FROM sessions
WHERE user_id IN (
  SELECT id FROM users WHERE login_key IN ('camile lisboa', 'lucas souto')
);
