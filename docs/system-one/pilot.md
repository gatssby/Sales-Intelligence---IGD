# Controlled real-call pilot

The pilot is local and experimental. It is never queued automatically, never reads a manifest from the catalog, and defaults to a read-only dry run.

A manifest is versioned JSON containing only 1–30 internal Call UUIDs. It contains no transcript, customer, seller, Drive or contact data. Curate IDs after a read-only metadata review; do not use the next N calls.

`npm run system-one:pilot -- --manifest=docs/system-one/pilot-manifest.example.json --dry-run --provider=laya`

Dry run reports only Call ID, existence, duration, transcript presence and estimated chunks. It does not read transcript text, invoke any provider, persist a run or mutate a queue.

Execution requires `--execute`. Persistence additionally requires `--persist`; the prepared migration remains unapplied in this phase. Reprocessing requires a new `--analysis-generation`, preserving prior rows.

Before an execution query reads transcript text, the pilot checks provider health and sends one synthetic request containing the exact `CALL_PILOT_QUESTIONS` schema. It requires every expected decision key and validates the domain value type for noul, choice and score. A failed health check, rejected request or incompatible response aborts before transcript loading. Dry run never invokes this provider preflight.

During execution, HTTP 400, endpoint HTTP 404, HTTP 422 and response-schema mismatch are systemic failures and abort the run immediately. They are not recorded as model decisions and are not retried across the remaining calls. Potentially transient provider unavailability remains a separate failure class without aggressive retries.

## Decisions and chunking

The schema `sales-decision-calls-v0.1` covers pain, impact, price objection, objection type/handling, social proof, urgency, CTA, next step and buyer intent. Chunks use `pilot-chunking-v0.1`: ordered, deterministic, whitespace boundaries, 8,000-character maximum and zero overlap. Timestamp spans are retained when a future transcript source exposes them; current catalog text has no timestamp span column.

Presence signals aggregate by evidence-backed OR. Objection types are a deterministic set; conflicting non-none values become `ambiguous` and require review. Buyer intent selects the highest observed level; spread greater than one level requires review. No arithmetic average is used.

Human labels are reviewed manually from `human-labels.example.csv`. Provider outputs, including Jev teacher signals, never become labels automatically.

Benchmarks calculate metrics by decision/provider only after human labels: accuracy, macro precision/recall/F1 where applicable, confusion matrix, abstention, coverage, confidence, Brier score when probabilities exist, latency, throughput, cost and provider agreement. They never declare a winner automatically.
