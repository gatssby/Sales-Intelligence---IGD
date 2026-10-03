# System One — architecture

## Scope

System One is a new analytical line, isolated from Generative AI v1. It evaluates structured decisions for Leads and Calls without requiring Luna, Sol, prompts, narrative coaching or generated insights.

```text
CALL CATALOG / LEAD SNAPSHOT
          |
          v
     DecisionEngine
      /         \
 Jev champion   Laya challenger
      \         /
       decision_runs
          |
 benchmark / labels / outcomes
```

The domain depends only on the `DecisionEngine` interface. Jev and Laya are adapters. PostgreSQL remains the operational source of truth; the local lab never mutates production.

## Active-set rule

`engine_family=generative-ai-v1` is an archive. `engine_family=system-one` starts empty. A dashboard or worker must select the family explicitly; it must never treat the latest row from any family as the active result.

## Non-goals in this phase

- no production migration or deploy;
- no automatic queue activation;
- no processing of the 5k+ call catalog;
- no generative AI request;
- no coaching, narrative interpretation or generated insight.
