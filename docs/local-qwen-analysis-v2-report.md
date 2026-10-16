Local Qwen Analysis v2 — benchmark report

Date: 2026-10-16
Branch: feat/qwen9b-analysis-v2
Scope: shadow-mode local inference only; no production database writes.

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
