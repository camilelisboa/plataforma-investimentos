# Implantação de produção — GitHub + Netlify

Baseline: **Connected Wealth 2.4.0 · Rodada 36 — Production Launch**.

## Arquitetura de publicação
- GitHub privado: código-fonte, histórico e versionamento.
- Netlify: frontend, Functions e ambiente publicado.
- Netlify Database/Postgres: persistência por usuário.
- URL inicial: `https://<nome-do-site>.netlify.app`. Domínio próprio é opcional.

## Antes de publicar
1. Criar um repositório **privado** no GitHub.
2. Subir o conteúdo deste projeto, sem arquivos `.env` reais.
3. Criar um novo site no Netlify conectado ao repositório.
4. Confirmar `publish = public` e `functions = netlify/functions` (já definidos em `netlify.toml`).
5. Provisionar o banco e aplicar todas as migrations até `027_round36_production_launch`.
6. Definir `PLATFORM_SETUP_TOKEN` no ambiente do Netlify.
7. Para o painel **Ao vivo**, configurar `BRAPI_TOKEN` (Brasil, câmbio, cripto e macro) e `TWELVE_DATA_API_KEY` (exterior). `FINNHUB_API_KEY` continua opcional para calendário econômico e resultados. Sem essas chaves, o painel mostra dados parciais e marca os blocos indisponíveis em vez de exibir zeros falsos.

## Primeiro acesso
1. Abrir a URL `.netlify.app`.
2. O painel **PRIMEIRO ACESSO** aparece enquanto o setup estiver pendente.
3. Informar o token de setup e definir senhas distintas para Camile e Lucas.
4. Depois do setup, o endpoint impede uma nova ativação.
5. Entrar em cada perfil, revisar Segurança e criar o primeiro backup real.

## Gate da Rodada 36
Na **Central 2.4**, usar **Verificar produção**. O lançamento só deve ser considerado concluído quando os checks de release, HTTPS, banco, setup, sessão, backup, isolamento e conciliação estiverem verdes.

## Dados reais
- O build não precisa conter dados pessoais.
- Importar/cadastrar carteira, movimentações e proventos depois da ativação.
- Rodar Conciliação e tratar qualquer caso antes de considerar o perfil operacionalmente fechado.

## Segurança
- Nunca commitar `.env` ou tokens.
- Manter o repositório privado.
- A prévia demonstrativa fica disponível apenas em arquivo/local; em produção o botão é ocultado.
- APIs autenticadas continuam fora do Cache Storage.

## Rollback
O código fica versionado no GitHub/Netlify e os dados do usuário permanecem cobertos pelo Private Vault. Antes de mudanças futuras, gere backup e mantenha um deploy anterior disponível para rollback de código.
