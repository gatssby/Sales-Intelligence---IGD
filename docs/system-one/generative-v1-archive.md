# Generative AI v1 archive

The Git reference `archive/generative-ai-v1` and annotated tag `generative-ai-v1` freeze the complete pre-System-One foundation at the selected commit.

The archive includes Luna/Sol configuration, prompts, policies, escalation, workers, analysis runs, scores, coaching, generated insights, cost controls, benchmarks, docs and migrations.

Database handling is logical first:

- existing rows are retained;
- migration `014_system_one_foundation.sql` labels legacy rows `generative-ai-v1`, generation `1`, and `active_for_product=false`;
- System One uses a separate engine family and starts with no results;
- no production rows are deleted in this phase.

Before any future destructive operation, create a PostgreSQL backup and an analysis-specific export, validate restore/listing, and obtain explicit approval.
