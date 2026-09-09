# First official INSIDER analysis batch — 2026-09-09

## Scope

- 30 queued calls with real transcripts already persisted in PostgreSQL.
- 30 completed; 0 failed; 0 skipped.
- 25 sellers covered.
- Benchmark attempts remained isolated and did not become official/current analyses.
- The pre-existing demo call was preserved.

No transcript, customer data, seller name, email or Google file identifier is recorded in this document.

## Production strategy

- Strategy: `insider-cost-quality-v1`
- Primary: `openai/gpt-5.6-luna`
- Escalation: `openai/gpt-5.6-sol`
- Confidence threshold: `0.50`
- Primary-only: 1
- Escalated: 29

The independent gate also checked schema validity, dimension coverage, evidence grounding, score consistency and the model's human-review signal. In this first production batch, the human-review signal caused most escalations. This is quality-first behavior, but the 29/30 escalation rate is too high for the intended long-term cost profile and must be recalibrated with audited labels before a larger batch.

## Cost receipts

Completed attempts persist `providerMetadata.gateway.cost` as `gateway_actual_cost_usd`. Token-price calculations remain a marked fallback only.

| Stage | Requests | Input tokens | Output tokens | Gateway actual cost | Estimated fallback cost |
|---|---:|---:|---:|---:|---:|
| Official primary | 30 | 562,000 | 80,329 | $0.219193 | $0.194943 |
| Official escalation | 29 | 536,276 | 88,310 | $2.046771 | $1.817145 |
| **Official total** | **59** | **1,098,276** | **168,639** | **$2.265964** | **$2.012088** |

Average actual official cost per completed call was approximately $0.075532. Average end-to-end model latency was 79.4 seconds per call.

The Vercel CLI reported key-level aggregate spend of $5.89816534 after the batch. This value is a reconciliation snapshot and may lag per-request receipts; it is not used as the hot-path budget counter.

## Scores and coverage

- Overall average: 53.98
- Median: 57.5
- Minimum: 0
- Maximum: 73
- Distribution: 5 calls from 0–39, 12 from 40–59, 13 from 60–79, 0 at 80+

Best average dimension was discovery (63.37). Lowest was objection handling (36.23), followed by qualification (39.77). The dashboard shows the real sample size for every seller and excludes benchmark results from KPI queries.

## Operational result

The official path exercised was:

`PostgreSQL queue → worker → AnalysisEngine → Vercel AI Gateway → Zod → analysis_attempts/analysis_runs → current official analysis → dashboard`

One earlier access-denied attempt remains preserved as history and was retried through the same queued worker path. No further catalog calls were analyzed.
