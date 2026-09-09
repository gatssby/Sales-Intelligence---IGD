# INSIDER analysis model benchmark — 2026-09-09

## Scope and safety

- Rubric: `insider-demo-v0`
- Prompt: `call-analysis-v0`
- Schema: `analysis-output-v0`
- Corpus: real transcripts already persisted in PostgreSQL; no transcript, customer data or Google file identifier is recorded here.
- Benchmark results are stored only in `benchmark_runs` / `benchmark_results` and cannot become current or affect product KPIs.
- Catalog basis: [Vercel AI Gateway catalog research](../research/vercel-ai-gateway-model-catalog-2026-09-09.md).

The original broad run was stopped twice after the all-model barrier made provider latency and cost hard to control. Before the second interruption, 39 results had been persisted, representing two distinct calls for each model (one very short/inconclusive call and one medium call). Completed combinations are reused across runs by call, model, rubric, prompt and schema.

## Budget reconciliation

The Vercel CLI identified the active key named `Sales Intelligence - IGD` and reported aggregate spend of **$3.73990898** at the decision checkpoint, against a key budget of $15. The database had $0.884713 in token-price estimates for persisted benchmark results. The gap includes requests that completed at the Gateway after the runner had been interrupted but before their outputs crossed the old persistence barrier, plus API probes. The CLI value is therefore the conservative reconciliation floor.

`BENCHMARK_MAX_COST_USD` is now a required logical benchmark cap. New requests reserve their projected cost before starting, completed combinations are reused, concurrency is limited to 1–4, and the runner rebuilds spend from persisted receipts with an optional reconciled Vercel floor. The key-level $15 quota was not changed.

## Screening evidence

The table deduplicates repeated attempts and reports the best persisted result for each of the two distinct calls. `Schema` is successful structured output. `Grounding` is the share of evidence quotes found after accent, punctuation and whitespace normalization. `Reference delta` compares overall score on the medium call with `openai/gpt-6-astra`.

| Model | Schema | Medium grounding | Reference delta | Medium latency | Persisted estimated cost | Finding |
|---|---:|---:|---:|---:|---:|---|
| `openai/gpt-6-astra` | 2/2 | 94.7% | 0 | 76.7s | $0.446402 | Best absolute/reference quality; too expensive for routine production |
| `openai/gpt-5.6-sol` | 2/2 | 58.3% | 12 | 74.1s | $0.085650 | Best practical escalation candidate |
| `openai/gpt-5.6-luna` | 2/2 | 30.0% | 25 | 29.5s | $0.007997 | Best cheap operational candidate; independent gate is necessary |
| `minimax/minimax-m3` | 2/2 | 28.6% | 14 | 26.1s | $0.009611 | Cheap and schema-reliable, but dimension disagreement was high |
| `spacexai/grok-4.3` | 2/2 | 40.0% | 46 | 11.8s | $0.029686 | Best latency among reliable completions; score bias too high |
| `alibaba/qwen3.8-flash` | 2/2 | 0.0% | 53 | 155.3s | $0.010705 | Cheap but slow and weakly grounded on the medium call |
| `mistral/mistral-medium-3.5` | 1/2 | 30.8% | 50 | 33.9s | $0.058332 | High score bias and one operational failure |
| `anthropic/claude-sonnet-5` | 1/2 | — | — | — | $0.020738 | Medium call failed in the controlled window |
| `moonshotai/kimi-k3` | 1/2 | — | — | — | $0.054475 | Medium call failed and cost was high |
| `google/gemini-2.5-flash` | 1/2 | — | — | — | $0.003632 | Medium call failed in the controlled window |
| `google/gemini-2.5-flash-lite` | 1/2 | — | — | — | $0.000433 | Cheapest valid short-call result; medium call failed |
| `deepseek/deepseek-v4-flash` | 1/2 | — | — | — | $0.000396 | Medium call failed in the controlled window |
| `zai/glm-5.3-flash` | 1/2 | — | — | — | $0.000441 | Severe score bias on the inconclusive short call; medium call failed |

Approximate model spend observed in the Vercel dashboard before receipt capture was introduced was dominated by Astra (~$0.51), Claude Sonnet 5 (~$0.38), GPT-5.6 Sol (~$0.28), Mistral Medium (~$0.20), Kimi K3 (~$0.18), Grok (~$0.11) and Gemini Flash (~$0.06). These figures are reconciliation evidence, not reconstructed per-request receipts.

## Confidence calibration

Self-reported confidence was not predictive by itself. High-confidence results also had poor grounding or large score disagreement. Thresholds from 0.50 through 0.95 produced the same accept/escalate classification once independent gates were applied. The selected threshold is **0.50**, the lowest point of that observed plateau, to avoid paying for escalation solely because a model was conservatively calibrated.

The production gate also checks valid Zod output, complete rubric dimensions, at least 50% evidence grounding, no more than 15 points between overall score and dimension aggregate, and the model's explicit human-review signal. The sample is small, so this threshold is versioned as an initial calibration rather than treated as a universal constant.

## Decision

- PRIMARY: `openai/gpt-5.6-luna`
- ESCALATION: `openai/gpt-5.6-sol`
- CONFIDENCE THRESHOLD: `0.50`
- Strategy version: `insider-cost-quality-v1`
- Future finalist set: Luna, Sol, Astra (reference only) and MiniMax M3.

Luna provides the best observed combination of schema reliability, cost and latency among cheap models. Sol was materially closer to the high-capability reference than Luna while costing far less than Astra, making it the practical escalation choice. Astra remains the quality reference and is not the production escalation model.

No additional Phase B request was started after reconciliation reached $3.73990898 of the $4 logical benchmark ceiling. The strategy was selected from evidence already paid for, preserving credits for the official batch.
