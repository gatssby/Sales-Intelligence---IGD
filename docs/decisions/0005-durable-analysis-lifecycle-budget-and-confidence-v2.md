# ADR 0005 — Lifecycle durável, budget global e Confidence Policy v2

## Status

Aceita em 2026-09-09.

O requisito de reconciliação live antes de toda request e o tamanho da reserva operacional foram substituídos pelo ADR 0006. As garantias de reserva atômica, receipt e recovery permanecem vigentes.

## Contexto

O worker anterior fazia claim concorrente, mas a resposta paga e a promoção para Official Analysis dependiam da memória do processo. O budget também era reconstruído por processo, e `requires_human_review` disparava escalation mesmo sendo um sinal comercial. Calls não avaliáveis podiam ainda receber score zero.

## Decisão

- `analysis_jobs` mantém um item operacional durável por Call, com lease, stage e recovery; `analysis_runs` continua sendo o histórico imutável de execuções.
- O claim permanece atômico com `FOR UPDATE SKIP LOCKED`. O lease é renovado durante execução e precisa exceder o timeout máximo de uma request. Um restart retoma escalation já decidida ou finaliza um resultado persistido, sem repetir o primary.
- Toda request paga, inclusive benchmark, exige reconciliação live da key Vercel e uma reserva conservadora em `ai_cost_reservations`, sob lock da conta global. O attempt e o custo real de `providerMetadata.gateway.cost` são liquidados sob o mesmo lock da conta.
- Reserva sem request pode ser liberada. Request iniciada sem receipt torna-se `outcome_unknown` e exige reconciliação; ela nunca é repetida automaticamente.
- O teto operacional é `limit_usd - safety_reserve_usd`. A conta permanece pausada após atingir o teto, inclusive depois de restart.
- `insider-confidence-v2` separa `requires_human_review` de escalation. Escalation usa schema inválido, grounding, coverage, coerência e confiança.
- `analysis-output-v1` distingue `scoreable` de `unscorable`. Resultado não avaliável preserva evidências e motivo, mas usa `overall_score=null` e fica fora de médias e rankings.
- O estágio `transcript` também é claimado com lease e `SKIP LOCKED`. O worker busca no máximo uma Call por slot, persiste o transcript antes de liberar a análise e recupera crashes entre essas duas operações. Tentativas por arquivo são limitadas; credencial Google expirada para o worker interrompe o processo sem condenar a Call.
- Análises históricas permanecem com seus schemas e policies originais; não há rewrite retroativo.

## Consequências

O PostgreSQL passa a conter todo o estado necessário para claim, recovery, budget e finalização idempotente. Ausência de receipt real interrompe o fluxo de forma conservadora. A fila pode continuar após restart sem criar duas Official Analyses atuais para a mesma Call.
