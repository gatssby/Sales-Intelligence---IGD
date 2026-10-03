# Rollout gates

This phase prepares code, schema and local tooling only.

## Safe now

- add adapters, schemas, tests and docs;
- add additive migrations;
- run synthetic local lab and provider mocks;
- prepare backup/export scripts;
- install/test Laya locally without production credentials.

## Approval required before the next phase

1. restorable production PostgreSQL backup;
2. analysis-specific Generative AI v1 export and listing validation;
3. migration review, including the current-analysis selection policy;
4. explicit System One pilot dataset and scope;
5. Jev live credential handoff through local secret storage, if a live benchmark is approved;
6. Laya health/benchmark evidence on the Mac;
7. separate approval for any production migration, deploy or queue activation.

`DRIVE_DISCOVERY_AUTO_QUEUE=false` remains unchanged. No production mutation is part of this branch.
