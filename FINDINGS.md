# Auth Behavioral Test Findings

Durante a criação da suíte de testes comportamentais reais para os handlers HTTP (`apps/web/test/auth-handlers.integration.test.ts`), os seguintes bugs e comportamentos não-implementados foram identificados através da análise estrutural e modelagem dos testes:

## 1. `PLATFORM_ADMIN` não suportado no Banco de Dados
A interface do usuário (`AppShell.tsx`) permite o papel `PLATFORM_ADMIN`, mas o banco de dados proíbe a criação de contas com esse papel devido à constraint de checagem.
**Evidência:** 
A migration `011_organization_sync_access.sql` define a constraint rigorosa: 
`check (role in ('ADMIN', 'USER', 'LEADER', 'SUPERVISOR', 'SALES_OPS'))`. 
**Resultado do Teste:** O bloco `t.before` falha silenciosamente (capturado no teste) ao tentar inserir um usuário sintético com esse papel.

## 2. Preview Mode (`VERCEL_ENV=preview`) permite mutações
Os endpoints de mutação da aplicação (`POST /api/spend/analyze` e `POST /api/admin/organization-sync`) não possuem validações para bloquear ações quando a aplicação roda em ambiente de Preview (`VERCEL_ENV=preview`).
**Resultado do Teste:** O teste `Preview Mode read-only blocks mutations` foi escrito com falha ativa (assumindo a ausência do código de proteção), falhando porque as mutações retornam 200/502 em vez de 403.

## 3. Scope escape por query params
Embora a função de catálogo chame `parseOrganizationSelection`, a garantia final não foi testada na API em si para bloquear manipulações (como `?product=beta` tentado por um LEADER). Se o DB for confiável na restrição, esse teste passará, caso contrário falhará (também coberto no arquivo de teste com a cláusula assertiva correspondente).

Os testes foram isolados na branch `feat/auth-behavioral-tests` conforme instruído, e não realizei alterações no código de produção a fim de "NÃO corrigir sem demonstrar claramente o comportamento esperado".
