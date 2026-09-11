# ADR 0004 — Autenticação da aplicação e controle de acesso

## Status

Aceita; transição de produção concluída em 2026-09-09. A atribuição manual de escopos organizacionais foi parcialmente substituída pelo [ADR 0008](0008-organization-sync-and-derived-access.md) para contas vinculadas a Person.

## Contexto

O dashboard nasceu protegido por uma única credencial no nginx. Esse controle não identifica o usuário, não limita dados por time/produto e não permite auditar administração ou tentativas de executar operações pagas.

## Decisão

- PostgreSQL é a fonte de verdade de usuários, hashes, sessões, escopos e auditoria.
- A senha usa bcrypt com custo 12; texto puro nunca é persistido.
- O navegador recebe um token de sessão aleatório em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção; apenas o hash SHA-256 do token fica no banco.
- Papel, capacidade e escopo são conceitos separados em `@igd/auth`.
- `ADMIN` e `SALES_OPS` possuem escopo global; `LEADER` recebe times explícitos; `SUPERVISOR` recebe produtos explícitos.
- Apenas `ADMIN` possui `spend:execute` na primeira versão.
- Repositórios de leitura aplicam o escopo dentro da consulta PostgreSQL, tanto para linhas quanto para agregações.
- Desativação e redefinição de senha revogam sessões imediatamente por `session_version` e `revoked_at`.
- Administração de contas gera auditoria sem senha, token, transcrição ou PII de leads.

## Consequências

Novas páginas e APIs devem receber um contexto de autorização e usar capacidades explícitas. Novos caminhos que possam aumentar custos devem passar por `spend:execute` antes de criar job ou chamar provider. A matriz poderá ganhar capacidades sem reescrever verificações de papel em cada tela.

Após uma transição operacional separada e explicitamente aprovada, o Basic Auth legado do nginx foi aposentado. A autenticação individual da aplicação é a camada principal. O arquivo `htpasswd` e a configuração nginx anterior permanecem protegidos na VPS somente para rollback operacional.
