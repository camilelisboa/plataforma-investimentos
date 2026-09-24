# Plataforma de Investimentos — Rodada 36 · Production Launch 2.4.0

A Rodada 36 encerra o segundo ciclo da plataforma e prepara a baseline para implantação real em **GitHub + Netlify**, sem depender de domínio próprio.

## Principais entregas
- **Central 2.4 · Launch Control** com gate explícito de produção;
- endpoint autenticado `/api/launch-readiness`;
- verificação de versão, HTTPS, banco, setup, sessão, backup, isolamento e casos de conciliação;
- exportação do checklist de lançamento em JSON;
- botão de prévia ocultado no ambiente publicado e preservado em arquivo/local;
- correção do `setup.mts` para gravar a baseline atual em vez da versão histórica 1.1.0;
- migration `027_round36_production_launch`;
- documentação `DEPLOY_PRODUCAO_GITHUB_NETLIFY.md`;
- `.env.example` sem segredos;
- `CHECKLIST_LANCAMENTO_R36.md`;
- PWA e cache alinhados em **2.4.0 · Rodada 36**.

## Operação
A plataforma pode ser publicada em uma URL gratuita `*.netlify.app`; um domínio próprio pode ser conectado depois sem reconstruir o sistema.

## Guardrails permanentes
- sem execução automática de compra/venda;
- sem recomendação automática;
- sem correção silenciosa de divergências;
- sem encerramento automático de casos ou revisões;
- APIs autenticadas fora do Cache Storage.

## Release
**Connected Wealth 2.4.0 · Rodada 36 — Production Launch**
