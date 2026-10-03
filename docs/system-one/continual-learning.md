# Continual learning skeleton

```text
real inputs
  -> Jev champion + Laya challenger
  -> separate decision runs
  -> human labels / future outcomes
  -> versioned training dataset
  -> candidate Laya asset
  -> deterministic benchmark
  -> explicit promotion decision
```

A prediction is never copied into `labels`. Jev output may be stored as `teacherSignals`, but only human review or observed outcomes can populate supervised labels. Every dataset carries a version and source hash.

Promotion is manual and records rationale, benchmark run and actor. There is no auto-deploy.
