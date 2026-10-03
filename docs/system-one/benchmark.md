# Benchmark

Benchmarks compare providers/models by decision key over a fixed, versioned dataset. They are separate from `decision_runs` and never become Current Analysis.

The frozen Jev × Laya protocol — cohort, decision contracts, chunking, aggregation, retry and metric versions, plus the canonical transcript resolver gap — is `benchmark-protocol-v01.md`.

Minimum metrics:

- accuracy, precision, recall and F1 where labels support them;
- calibration;
- false positives and false negatives;
- latency, throughput and cost.

Generative AI v1 is a secondary historical comparison only. It is not a gold label source and no winner is declared without real labels/outcomes.
