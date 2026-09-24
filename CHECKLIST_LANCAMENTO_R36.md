# Checklist de lançamento — R36

## Código
- [ ] auditoria estrutural R36 sem IDs duplicados ou refs ausentes
- [ ] `node --check public/app.js` aprovado
- [ ] TypeScript sem erros do projeto
- [ ] versão 2.4.0 alinhada em package, PWA, backend e migration

## GitHub
- [ ] repositório privado criado
- [ ] branch principal protegida conforme preferência
- [ ] `.env` real não foi commitado

## Netlify
- [ ] site conectado ao repositório
- [ ] URL `.netlify.app` definida
- [ ] banco provisionado
- [ ] migrations 001–027 aplicadas
- [ ] `PLATFORM_SETUP_TOKEN` configurado
- [ ] integração de mercado configurada somente se desejada

## Primeiro acesso
- [ ] setup único concluído
- [ ] login Camile testado
- [ ] login Lucas testado
- [ ] isolamento de dados conferido
- [ ] primeiro backup real criado

## Operação
- [ ] carteira real cadastrada/importada
- [ ] conciliação executada
- [ ] nenhum caso crítico aberto
- [ ] Central 2.4 / Gate de lançamento 100%

## Guardrails
- [ ] nenhuma ordem automática
- [ ] nenhuma recomendação automática
- [ ] nenhuma correção silenciosa de dados
- [ ] encerramentos continuam humanos e rastreáveis
