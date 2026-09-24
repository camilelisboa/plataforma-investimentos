# Correção Ao vivo — R36.1

## O que foi corrigido
- Valores ausentes não são mais convertidos para `0` / `R$ 0,00` / `+0,00%`.
- O resumo do desk ignora ativos indisponíveis ao calcular médias.
- O backend deixa explícito quando `BRAPI_TOKEN` e `TWELVE_DATA_API_KEY` não estão configurados.
- Sem `BRAPI_TOKEN`, o backend não desperdiça chamadas em endpoints restritos da brapi; mantém apenas as ações de sandbox suportadas.
- O Service Worker recebeu uma nova chave de cache para garantir que o navegador baixe o `app.js` corrigido no próximo deploy.

## Para o Ao vivo carregar dados completos no Netlify
Em **Project configuration > Environment variables**, defina:

- `BRAPI_TOKEN`: necessário para Ibovespa, câmbio, cripto e macro na arquitetura atual.
- `TWELVE_DATA_API_KEY`: necessário para EUA, exterior, commodities e Treasuries.
- `FINNHUB_API_KEY`: opcional, usado para calendário econômico e resultados.

Depois das variáveis, faça um novo deploy. As chaves devem permanecer somente no ambiente do Netlify; não coloque segredos no repositório.
