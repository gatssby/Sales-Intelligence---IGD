# ADR 0011 — Gemini Web como worker operacional aditivo

## Status

Aceita em 2026-09-22 para o POC operacional.

## Contexto

O backlog oficial permanece em `analysis_jobs`, mas o worker pago está pausado por budget. Como o worker histórico acoplava busca de Transcript e análise paga, milhares de Calls ficaram em `awaiting_transcript`. Um POC já provou que uma sessão Workspace autenticada no Gemini Web pode produzir análises estruturadas válidas, mas a implementação operacional existente mistura launchers divergentes, estado de processos não validado e regras incompletas de concorrência.

## Decisão

- `analysis_jobs` continua sendo a autoridade de trabalho. Um worker remoto separado busca somente Transcripts; um feeder envia somente jobs `ready` à fila `gemini_poc_jobs`.
- O worker Gemini Web é aditivo e não participa do ledger de budget pago.
- A ordem de processamento é mais recente para mais antiga, com `started_at` e fallback verificado por `source_row`.
- Uma falha terminal do POC não é reaberta automaticamente.
- A conclusão Gemini preserva histórico e nunca substitui uma Current Analysis produzida concorrentemente por outro provider.
- Eventos ordenados do POC registram claims, conclusões e falhas para operação e watcher; contadores agregados não definem sequência.
- A produção usa exatamente uma aba Brave e um transcript worker remoto, ambos vinculados a uma identidade única de execução.
- O launcher, o stop e os watchers compartilham um protocolo de ownership com lock atômico, PID validado e cleanup limitado à execução proprietária.
- O launcher principal nunca desliga o Mac. Shutdown é uma operação opcional e separada.
- Testes de integração usam somente banco `_test` local via túnel e não podem ser considerados aprovados quando skipped.

## Consequências

O POC pode drenar o backlog sem reativar gasto pago, enquanto PostgreSQL preserva a consistência oficial. A operação depende da sessão humana do Gemini Web, do userscript instalado e de ausência de verificação/CAPTCHA; esses eventos interrompem o worker e exigem intervenção humana. O POC continua experimental e não substitui a abstração oficial de providers.
