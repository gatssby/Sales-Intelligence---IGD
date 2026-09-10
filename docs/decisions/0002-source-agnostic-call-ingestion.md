# ADR 0002 — Ingestão de calls desacoplada da fonte

## Status

Aceita em 2026-09-09.

## Contexto

A automação temporária baseada nas planilhas CRM do INSIDER foi retirada do escopo. A entrada inicial será um lote manual e controlado; futuramente, a mesma call poderá ser descoberta no Google Drive ou por outro conector.

## Decisão

- `calls.transcript_file_id` é a identidade canônica única da call neste MVP.
- `call_sources` guarda uma ou mais origens e aponta para a mesma call canônica.
- a constraint `UNIQUE` em `calls.transcript_file_id` é a última barreira contra duplicação concorrente;
- a relação composta entre `call_sources(call_id, transcript_file_id)` e `calls` impede uma origem de apontar para uma call com outra identidade;
- toda entrada passa pela função PostgreSQL `upsert_call_source`, independentemente da origem;
- transcrições são versionadas pelo hash do conteúdo;
- uma análise oficial é um `analysis_run` concluído e marcado como `is_current`;
- descoberta de uma nova origem nunca cria outra análise quando essa análise oficial já existe;
- reanálise continua possível de forma explícita usando outra versão de rubrica, prompt ou modelo.

## Consequências

O importador manual e futuros adaptadores de Drive/CRM compartilham as mesmas garantias. Não há fingerprint por cliente, data ou gravação nesta fase. Corrigir um `transcript_file_id` exige tratamento explícito, porque uma identidade de origem já ligada a outro ID é rejeitada como conflito em vez de ser movida silenciosamente.
