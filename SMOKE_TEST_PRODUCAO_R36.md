# Smoke test de produção — Rodada 36

Execute depois do primeiro deploy e do setup único.

1. `npm install` e `npm run check` no ambiente de desenvolvimento/CI.
2. Confirmar que `/api/health` responde com `version: 2.4.0`.
3. Confirmar que `/api/deployment-status` reporta Rodada 36 e `setupRequired=false`.
4. Entrar com Camile e Lucas em sessões separadas.
5. Cadastrar um registro de teste em um perfil e confirmar que não aparece no outro.
6. Criar um backup manual em cada perfil.
7. Abrir **Central 2.4** e executar **Verificar produção**.
8. Confirmar HTTPS, banco, setup, sessão, backup e isolamento em verde.
9. Rodar Conciliação após carregar dados reais e tratar casos ativos.
10. Confirmar que o botão de prévia não aparece na URL publicada.
11. Confirmar que o navegador não mantém respostas `/api/` no Cache Storage.
12. Exportar o checklist de lançamento e arquivar junto do primeiro backup.
