# ADR 0008 — Organization Sync e acesso derivado do grafo temporal

## Status

Aceita em 2026-09-10.

## Contexto

O modelo anterior mantinha escopos de Leader e Supervisor explicitamente por conta. A organização oficial atual existe em uma Google Sheet, enquanto calls, autorização e dashboards precisam de estado durável, histórico e seguro contra leituras incompletas.

## Decisão

- A Google Sheet é a fonte da organização atual; PostgreSQL é a fonte operacional e histórica.
- `OrganizationSync` é um módulo separado de Drive Discovery e usa o mesmo OAuth server-side somente para leitura.
- Cada leitura produz um candidate snapshot; headers, identidade, conflitos, volume e remoções são validados antes de uma publicação transacional.
- Memberships, leaderships e Organizational Roles são temporais. Sem data de vigência na fonte, o instante observado é o `valid_from`; nenhuma história anterior é inventada.
- Uma linha ausente não inativa uma Person. Somente um estado inativo explícito encerra suas relações atuais.
- Contas podem ser ligadas a `Person`. O Effective Access é a união de produtos supervisionados, times liderados e self; `leader_in_training` não concede acesso.
- Admin é exclusivamente um System Role e sempre global. A fonte organizacional nunca o concede.
- O Selected Scope é validado pela interseção com o Effective Access dentro das queries PostgreSQL, inclusive listagens, IDs e agregados.
- Escopos manuais antigos permanecem somente como fallback para contas ainda não vinculadas, permitindo migração e rollback sem perda de acesso.

## Consequências

O mesmo conjunto de read models serve Admin, Supervisor, Líder e Person. Mudanças futuras de time não reclassificam calls antigas, e falhas ou reduções anormais na planilha preservam o último snapshot publicado. A derivação de acesso passa a depender de Organization Sync saudável, mas uma falha do sync não remove a organização anterior.
