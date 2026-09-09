# ADR 0003 — Strategy com attempts e benchmark isolado

## Status

Aceita em 2026-09-09.

## Contexto

Uma avaliação oficial pode precisar de primary, retry técnico e escalation, enquanto um benchmark executa vários modelos sobre a mesma Call sem poder alterar KPI. Tratar cada request ao provider como um `analysis_run` mistura o processo lógico com suas tentativas e torna difícil preservar ambos os históricos com segurança.

## Decisão

- `analysis_runs` representa o processo lógico de produção que pode se tornar uma Official Analysis;
- cada chamada ao provider é persistida como uma `analysis_attempt`, incluindo função, modelo, métricas e erro sanitizado;
- primary e escalation pertencem ao mesmo Analysis Run, e somente o resultado final aceito pode marcar esse run como `current`;
- benchmarks usam `benchmark_runs` e `benchmark_results` separados, sem coluna ou caminho que permita virar `current`;
- a estratégia de produção é configurada por primary, escalation e Confidence Gate, sem slugs hardcoded no worker;
- o worker conhece uma única interface de processamento e não implementa seleção de modelo, retries, custo ou regras de escalation.
- cada attempt persiste o custo real reportado pelo Gateway quando disponível, mantendo a estimativa por tokens apenas como fallback explicitamente identificado;
- o benchmark reconstrói seu budget a partir dos receipts persistidos e de um piso reconciliado com a Vercel antes de iniciar novos requests.

## Consequências

O histórico do 403 anterior pode ser preservado como Analysis Attempt ao reenfileirar o mesmo Analysis Run. Experimentos e resultados oficiais podem usar o mesmo Transcript e as mesmas versões sem colisão nem contaminação do dashboard. A estratégia pode mudar por configuração e versão, mantendo rastreabilidade dos resultados anteriores.
