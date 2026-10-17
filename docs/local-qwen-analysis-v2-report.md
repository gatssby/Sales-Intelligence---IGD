Local Qwen Analysis v2 — benchmark report

Date: 2026-10-17 (historical measurements retain their original dates)
Branch: feat/qwen9b-analysis-v2
Scope: shadow-mode local inference only; no production database writes.

## Update — 2026-10-17: clean control completed; hybrid blocked by context

This update supersedes the historical execution status below. The hybrid is NOT complete and has no valid regression B or final `comparison.json`. No missing result is imputed.

### Control A — clean 9B-only

Artifacts: `real-benchmark/experiments/9b-only-long-20261016/closer-insider-v1/` on the VPS. A was neither recalculated nor modified during downstream recovery.

- Regression A: valid=true; 514 turns, 8 chunks, 129 evidence records, zero quote mismatches and invalid turn IDs.
- End-to-end pipeline wall: 18,156,876 ms (5 h 02 m 37 s), excluding model load.
- Evidence request wall sum: 6,182,662 ms (1 h 43 m 03 s).
- Global request wall sum: 11,974,184 ms (3 h 19 m 34 s).
- Input/output tokens: 157,230 / 19,096.
- All 12 stage metrics report checkpoint reuse=false, retries=0, finish_reason=stop. Cache-token counts were not instrumented for this run; absence of checkpoint reuse does not imply absence of server prompt caching.

| Stage | A request wall ms | B successful request/server ms |
|---|---:|---:|
| Evidence | 6,182,662 | 5,617,289.26 |
| Commercial | 2,048,911 | 3,288,661 |
| Closer evaluation | 3,736,575 | blocked before inference |
| Critic | 2,963,784 | not run |
| Final | 3,224,914 | not run |
| Total pipeline | 18,156,876 | unavailable: incomplete |

B evidence is reconstructed from successful llama.cpp timing records across resumptions, not a clean uninterrupted pipeline wall. Four failed evidence attempts consumed an additional 4,284,768.4 ms (1 h 11 m 25 s), excluded from its successful-only sum. The apparent successful-evidence saving is approximately 565.37 s / 9.14%; this is not an end-to-end speedup. B commercial alone took 1,239.75 s / 60.51% longer than A commercial.

### Recovery and commercial checkpoint B

The confirmed commercial failure at 2048 output tokens was corrected with a per-execution commercial=4096 override. Baseline defaults remain commercial=2048, closer=6144, critic=3072, final=3072. Budget overrides fingerprint the affected global stage and downstream stages, but do not change evidence fingerprints.

`ops/resume-hybrid-downstream.py` validates all eight evidence checkpoints and reconstructs/compares the exact persisted ledger before starting only the 9B. It cannot fall back to extraction. No 4B was loaded during this recovery. SHA-256 verification after termination confirmed all eight evidence checkpoints and `evidence.json` remained unchanged.

Persistent runtime: `si-hybrid-downstream-benchmark.service`, launched 2026-10-17 13:31:39 UTC; failed observably at the context gate at 14:26:57 UTC. Journald retains the error. Server alias and `/v1/models` were verified as qwen3.5-9b after load, with a single server. Recovery load time was 26,057 ms; it is additional overhead, not a replacement for the original measured 47,728 ms 4B→9B switch (45,050 ms 9B load).

Commercial B completed with runtime JSON-schema validation, valid evidence references and normalized outcome; its checkpoint was separately reused with an inference-forbidden provider to prove no request was made.

- Input/output: 26,948 / 2,204 tokens.
- max_tokens=4096; finish_reason=stop; retries=0.
- Prefill: 2,208,353.776 ms; generation: 1,080,168.141 ms.
- Provider rates: 12.203 prompt tokens/s; 2.040 generation tokens/s.
- Request wall: 3,288,661 ms (54 m 49 s).

### Exact context blocker

Token counts use the installed server's `/apply-template` and `/tokenize`, matching the commercial response's measured input count exactly. Payload character estimates are logged separately and are not treated as true token counts.

| Stage | Payload chars | Estimated payload tokens | Actual prompt tokens | Requested output | ctx | Headroom | Safe |
|---|---:|---:|---:|---:|---:|---:|---|
| Commercial | 82,946 | 20,737 | 26,948 | 4,096 | 32,768 | 1,724 | yes |
| Closer evaluation | 85,644 | 21,411 | 28,711 | 6,144 | 32,768 | -2,087 | no |

Closer requires 34,855 tokens including its requested output allowance. The request was not sent. No evidence compression, budget reduction, schema/playbook change, larger context or context shift was applied. Critic/final cannot be counted accurately before their upstream artifacts exist; no numbers are invented for them. `run.json` now identifies `blocked_context`; `downstream-status.json` records the actual failure and evidence integrity proof. The server exited cleanly after the block.

### Evidence size and semantic audit

| Metric | 9B evidence | 4B evidence |
|---|---:|---:|
| Raw / merged records | 129 / 129 | 194 / 194 |
| Compact ledger JSON chars | 60,050 | 82,805 |
| Estimated ledger tokens, chars/4 | 15,013 | 20,702 |
| Per-chunk records | 18,12,29,29,15,16,10,0 | 11,21,23,77,24,18,15,5 |
| Unique referenced turns | 108 | 171 |
| Exact-key duplicates removed | 0 | 0 |
| Maximum identical-claim frequency | 1 | 75 |
| Goals / objections / offers | 18 / 17 / 38 | 8 / 11 / 112 |

Both ledgers use exact hydrated quotes; the independent B evidence audit found zero quote mismatches and invalid turn IDs. This does NOT establish semantic entailment. B produced 75 repetitions of the same claim across different turns, including acknowledgments and unrelated content. These are not exact turn+claim duplicates, so the existing merger correctly did not silently discard them. They inflate the ledger by 37.89% in compact characters; record count increases 50.39% without demonstrating higher useful commercial recall.

There are 81 shared referenced turns. Turn+type multiset matching gives 51 common records, 78 A-only and 143 B-only; these are lexical/structural diagnostics, not semantic recall scores. Different type labels and nearby-turn references often describe the same topic.

Sanitized qualitative findings, grounded by turn IDs:

| Source location | Observation | Assessment |
|---|---|---|
| B T000224/T000240 and surrounding repeated records | Detailed offer/social-proof claim attached to acknowledgments | Unsupported turn-level claim, despite exact quote hydration |
| B T000308 | Access-duration claim attached to a minimal acknowledgment | Unsupported by referenced turn |
| B T000413 | Sensitive identifier asserted from a turn that asks for it | Attribution/entailment failure; no identifier copied here |
| B T000511 | Verbal farewell treated as an observed physical gesture | Unsupported inference |
| A T000085/T000171/T000414 | Purchase commitment, financial blocker or identifier overstated relative to the referenced turn | Baseline is not gold truth either |
| A T000164/T000210 | Concrete personal goal and direct description of the marketing need absent from B's corresponding source turns | Recall loss at these source locations; related broader goals remain in B |
| A T000390 vs B payment evidence | Exact negotiated installment terms absent from B; broader liquidity/card-limit/next-payment constraints retained | Material loss of specificity, not total omission of budget constraints |
| A T000377 vs B T000360/T000402 | Explicit decision turn absent, but other commitment/payment evidence retained | Do not count as complete loss of decision/interest |

Commercial enum fields are identical between A and B: current fit=high, future potential=medium, authority=confirmed, capacity=confirmed, urgency=high, decision process=unknown, availability=high, outcome=unknown. Narrative equivalence is not established: B interprets an ambiguous payment fragment as the total project investment and introduces a psychological condition; A also contains tension between confirmed capacity/authority and its stated gaps. These require human review. Closer/critic/final impact remains unmeasured because B is blocked.

### Postprocessor repair and current verdict

The old inline `bash -c` postprocessor ended with malformed literal newline/quoting, producing the observed unexpected-end-of-file error. It was replaced by a versioned shell chain with no embedded heredoc and a Python postprocessor. `bash -n`, Python compilation, rejection of invalid/missing regressions and an end-to-end synthetic smoke test passed. The real postprocessor correctly exits nonzero while B regression is missing; it does not publish a fake `comparison.json`. `regression.jsonn` remains preserved as an earlier failed-run artifact, not a valid regression.

Remote diagnostics: `comparison.blocked.json`, `ledger-size-comparison.json`, `evidence-timing-audit.json`, `commercial.preflight.json`, `commercial.metrics.json`, `closer_evaluation.preflight.json` and `downstream-status.json`. `comparison.blocked.json` is explicitly partial and is not the requested completed comparison.

Recommendation for the current configuration: MANTER 9B-ONLY. The present hybrid has a measurable context failure and substantial semantic noise; raw extractor speed cannot justify adopting it. Full A×B final-output quality and end-to-end speed remain inconclusive. Do not run the second call, selective escalation or a new real-payload cache inference under the premise that B succeeded. Existing synthetic cache measurements below remain valid, but no hybrid/shared-prefix speedup is claimed.

Next experiment: a separately versioned extractor-quality variant with deterministic detection of identical-claim repetition across distinct turns and human-reviewed targeted reread, before repeating downstream comparison. Do not automatically delete the 75 records from this experiment. Any larger-context or semantic ledger revision is a new variant, not a transparent retry. Current sample supports only A capacity of about 4.76 similarly sized calls/24h; there is no defensible B throughput or duration-only 30/60/90-minute extrapolation.

## Historical notes — 2026-10-16

1. Executed baseline

Call: 77d37a58-fcb5-40b1-9568-cd3dcb8e88ed
Transcript artifact: real-benchmark/closer-insider-v1-long/verbatim-long.txt
Chunking: max_turns=80, overlap_turns=8
Evidence checkpoints reused: 8/8
Model: qwen3.5-9b, Q4_K_M, night profile, 4 threads, ctx 32768, reasoning off
Timeout: 5400 seconds

Completed artifacts on the VPS:
- turns.json
- source.json
- evidence.json
- commercial_state.json
- closer_evaluation.json
- critic.json
- final.json
- metrics.json
- run.json
- closer-insider-v1.json

Deterministic regression:
- valid: true
- turns: 514
- chunks: 8
- evidence: 129
- grounded evidence: 129/129
- quote mismatches: 0
- invalid turn IDs: 0
- outcome: unknown
- current opportunity fit: high
- future requalification potential: medium

2. Robustness findings

Global stage checkpoints now include transcript, upstream artifact, prompt, schema, pipeline/playbook, chunk configuration, max_tokens and model fingerprints. Checkpoints are written atomically immediately after validation.

A real long-call run exposed two output-budget failures:
- closer_evaluation reached the 4096-token limit and retried; 6144 was required for this ledger.
- critic reached the 1536-token limit and retried; 3072 was required.

The successful request timings observed in llama.cpp logs were approximately:
- commercial: 639 s
- closer_evaluation successful retry: 2887 s
- critic successful retry: 2755 s
- final successful request: 3287 s
- end-to-end wall from first global request to final release: 12992 s (3 h 36 m 32 s)

The run included failed/truncated attempts before successful retries. Therefore the end-to-end number is the operational wall time for this robustness run, not a clean single-pass benchmark.

The CLI previously overwrote evidence checkpoint metadata with presentation artifacts. This was fixed; checkpoint files are now preserved and legacy fingerprints are upgraded atomically without re-inference.

3. Qualitative baseline summary

The 9B output was structurally complete and fully grounded. Commercial reconstruction separated current fit from future potential, preserved unknown outcome when explicit outcome evidence was absent, and surfaced qualification gaps involving capacity/budget, authority, urgency and decision process.

The Closer evaluation returned assessments for all required areas. The critic found four issues, two moderate and two minor. The final synthesis returned four strengths, three critical failures, two missed opportunities and three coaching actions. The primary failure concerned explicit confirmation of authority/decision ownership. No human-review flag was raised by the model; this is not treated as gold truth.

The analysis is useful as an engineering baseline, but qualitative quality still requires human evaluation. Historical LLM outputs were not used as gold truth.

4. llama.cpp prompt-cache microbenchmark

Artifact: real-benchmark/cache-microbenchmark-20261016.json
Server: llama.cpp 0.6.0-dev, commit a0e6dc7
Model: qwen3.5-9b
Representative prompt: 23,806 characters / 4,713 input tokens

| Request | Wall | Cached tokens | Prompt tokens processed | Prompt time |
| first | 282.192 s | 0 | 4,713 | 280.747 s |
| identical second | 1.870 s | 4,709 | 4 | 0.524 s |
| small suffix change | 34.938 s | 4,197 | 519 | 33.417 s |

Conclusion: prompt caching is real and substantial in the installed server. Identical shared prefixes should be preserved experimentally. The small suffix-change result shows that cache reuse is prefix-sensitive, not a transparent replacement for semantic prompt redesign.

5. Isolated 4B vs 9B speed benchmark

Artifact: real-benchmark/isolated-model-speed-20261016.json
Same machine, same short synthetic prompt, sequential model loading, no concurrent inference.

| Model | Load | Wall | Prompt tok/s | Generation tok/s |
| qwen3.5-4b | 14.043 s | 20.585 s | 27.71 | 9.12 |
| qwen3.5-9b | 26.026 s | 31.709 s | 17.98 | 6.02 |

The Qwen 4B model is installed at:
/home/ubuntu/sales-intelligence-local-llm/models/Qwen3.5-4B-Q4_K_M.gguf
Size: 2,740,937,888 bytes

Post-download VPS state: approximately 11 GB free, 20 GB available memory, both Qwen GGUFs present. The 4B was not left resident with the 9B; the isolated benchmark stopped each server before loading the other.

6. Architecture comparison status

9B-only baseline: completed and deterministically valid.
9B-only clean benchmark: not completed as a separate empty-checkpoint run; the executed run reused the mandated eight historical evidence checkpoints and then measured the expensive global stages.
4B→9B full hybrid: not completed in this session. The 4B was installed and speed-tested, but the full hybrid evidence extraction plus downstream 9B run remains pending.
Selective escalation/retrieval: design not promoted; no production behavior changed.

7. Recommendation

Do not declare the hybrid architecture a quality winner yet. The evidence currently supports:
- keep the 9B pipeline as the quality baseline;
- adopt global stage checkpointing and atomic incremental artifacts;
- preserve shared prefixes and use llama.cpp prompt caching only as an experimental optimization;
- run the full 4B evidence → deterministic hydration → 9B downstream benchmark before making an architecture decision.

The 4B has a measured raw speed advantage on the VPS, but no evidence from this session establishes that it preserves material commercial coverage on the long call.

8. Reproduction and artifacts

Remote workspace:
/home/ubuntu/sales-intelligence-local-llm/pipeline-v2

Baseline artifacts:
/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/closer-insider-v1-long/closer-insider-v1

Cache benchmark:
/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/cache-microbenchmark-20261016.json

Isolated speed benchmark:
/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/isolated-model-speed-20261016.json

No transcript, quote, GGUF or real-call output is committed to Git.
