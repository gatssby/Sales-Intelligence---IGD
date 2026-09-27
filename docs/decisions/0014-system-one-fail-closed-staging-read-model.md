# ADR 0014 — System One fail-closed staging/read model

Date: 2026-09-27
Status: Accepted for private, derived dry-run only

## Contexto

A auditoria offline de scope e identidade do System One confirmou 1.014 transcript assets verificados conhecidos, com intervalo determinístico de 1.014 a 1.026 e doze assets que permanecem um irreducible transcript scope gap. A regra canônica atual apresentou false splits conhecidos, mas a substituta baseada em mutual-nearest-neighbor não foi validada no corpus observado e, portanto, não pode substituir a identidade canônica.

O catálogo legado `public.calls` contém 5.235 current rows. A auditoria as classifica como 22 diretamente elegíveis, 1 candidate reconciliable, 5.203 `CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE` e 9 unresolved. Essas categorias têm níveis epistemológicos diferentes e não podem ser colapsadas em fatos canônicos.

A documentação de proveniência já recomenda um staging/read model reconciliado com `public.calls`, preservando os dados legados até uma reconciliação aditiva futura. As migrations 014 e 015 são dedicadas, respectivamente, a decisões do engine/piloto e não fornecem um modelo de provenance, candidate linkage, scope exception ou current-row reconciliation.

## Decisão

Criar um read model local, privado, reproduzível e fail-closed, derivado exclusivamente de artifacts offline já existentes.

O read model terá três coleções tipadas e separadas:

1. fatos canônicos: observações deterministicamente verificadas e a logical-call identity canônica atual;
2. candidate associations: hipóteses audit-only, inicialmente `C_TRUE_MUTUAL_NEAREST_NEIGHBOR`, sem qualquer promoção automática;
3. scope/identity exceptions: gaps, unresolved references, ambiguidades, conflitos e inacessibilidade relevantes.

A API padrão será canonical-only. Candidate associations e exceptions exigirão métodos explícitos. O status do snapshot exporá que scope é bounded, não exatamente validado, e que a regra substituta não foi validada no corpus observado.

O modelo não pode promover resultados derivados de MNN, candidate linkage, p95 linkage, scope bounded ou inferência de ausência de transcript a partir de candidate audit. Em particular:

- 1.014 permanece o lower bound de verified transcript assets conhecidos/canônicos;
- 1.026 permanece upper bound, nunca total canônico;
- 12 permanecem exceções de scope;
- 55 permanecem candidate groups MNN;
- 5.203 permanece uma categoria candidate/audit-only;
- 9 current rows permanecem unresolved.

Identidades de records e hash do snapshot serão determinísticos e derivados apenas de conteúdo versionado, normalizado e ordenado. Timestamp de build não participará da identidade.

## Consequências

- Consumers futuros podem consumir fatos canônicos sem receber candidates implicitamente.
- Consumers que precisarem de hypotheses ou gaps precisarão pedi-los explicitamente e tratar seu nível epistemológico.
- O read model não torna o corpus globalmente validado e não muda a elegibilidade ou identidade de registros existentes.
- O dry-run pode avançar sem Drive, PostgreSQL, providers, corpus, rede, migrations ou deploy.
- O modelo oferece um contrato de persistência futuro, mas nenhuma tabela é criada nesta decisão.

## Persistência futura

Uma persistência futura exigirá design, ADR complementar quando necessário, migration aditiva separada e aprovação explícita. Ela não reutilizará migrations 014 ou 015 e não alterará `public.calls` como etapa implícita.

## Não decidido

- schema físico PostgreSQL para staging, candidates, exceptions e snapshots;
- política de aprovação humana para promover qualquer candidate;
- mudança da regra canônica de identidade;
- uso do read model por filas, dashboard ou análise produtiva.
