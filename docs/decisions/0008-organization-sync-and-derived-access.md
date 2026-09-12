# ADR 0008 — Organization Sync e acesso derivado do grafo temporal

## Status

Aceita em 2026-09-10; a união genérica de responsabilidades e o tratamento de Líder em treinamento foram substituídos pelo [ADR 0010](0010-organizational-cargo-and-derived-access.md).

## Contexto

O modelo anterior mantinha escopos de Leader e Supervisor explicitamente por conta. A organização oficial atual existe em uma Google Sheet, enquanto calls, autorização e dashboards precisam de estado durável, histórico e seguro contra leituras incompletas.

## Decisão

- A Google Sheet é a fonte da organização atual; PostgreSQL é a fonte operacional e histórica.
- `OrganizationSync` é um módulo separado de Drive Discovery e usa o mesmo OAuth server-side somente para leitura.
- Cada leitura produz um candidate snapshot; headers, identidade, conflitos, volume e remoções são validados antes de uma publicação transacional.
- Memberships, leaderships e Organizational Roles são temporais. Sem data de vigência na fonte, o instante observado é o `valid_from`; nenhuma história anterior é inventada.
- Uma linha ausente não inativa uma Person nem encerra seus papéis. Somente uma linha representada com mudança explícita encerra relações; um campo de papel inválido preserva apenas o papel correspondente, e identidade de líder inválida preserva liderança anterior nos times envolvidos.
- `sellers` continua compatível para ingestão: resolve uma Person organization-first pelo V-code, mas não pode sobrescrever sua identidade ou atividade. Reconciliação por nome só consome times legados sem frente e rejeita reivindicação ambígua entre várias frentes, evitando colapsar homônimos.
- Contas podem ser ligadas a `Person`. O Effective Access é a união de produtos supervisionados, times liderados e self; `leader_in_training` não concede acesso.
- Admin e Platform Admin são exclusivamente System Roles e sempre globais. A fonte organizacional nunca concede nenhum deles.
- O Selected Scope é validado pela interseção com o Effective Access dentro das queries PostgreSQL, inclusive listagens, detalhes/transcripts por ID e agregados. Métricas de Pessoas/Times podem receber o mesmo dia da composição histórica.
- Escopos manuais antigos permanecem somente como fallback para contas ainda não vinculadas. No primeiro publish, times legados equivalentes são reconciliados pelo mesmo UUID antes de uma conta migrar para acesso derivado, preservando calls e scopes históricos.

## Consequências

O mesmo conjunto de read models serve Platform Admin, Admin, Supervisor, Líder e Person. Mudanças futuras de time não reclassificam calls antigas, e falhas ou reduções anormais na planilha preservam o último snapshot publicado. A derivação de acesso passa a depender de Organization Sync saudável, mas uma falha do sync não remove a organização anterior.
