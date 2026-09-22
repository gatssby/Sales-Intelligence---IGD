# Gemini Web Browser POC

## Propósito

Este documento descreve o componente de *Proof of Concept* (POC) para executar *jobs* de análise de calls usando a interface web do Gemini no navegador como um *worker* externo.

O fluxo de processamento de AI oficial é delegado ao *Vercel AI Gateway* e está implementado com um controle de budget estrito. Esta abordagem visa explorar uma alternativa aditiva e experimental que permite usar sessões *Workspace* já autenticadas no navegador, minimizando o impacto no fluxo de orçamento, sem alterar o funcionamento estável atual em produção.

## Componentes

A POC introduz os seguintes componentes:

1. **Fila e Workers (DB)**: `gemini_poc_jobs`, `gemini_poc_workers` e `gemini_poc_job_events` rastreiam a fila aditiva, workers e eventos ordenados de ciclo de vida. Nenhuma PII é copiada para eventos; apenas referências e códigos de erro sanitizados são utilizados.
2. **Endpoints HTTP de API**: Interfaces para a comunicação com o navegador (Tampermonkey):
   - `POST /api/poc/gemini/claim`
   - `POST /api/poc/gemini/heartbeat`
   - `POST /api/poc/gemini/complete`
   - `POST /api/poc/gemini/fail`
3. **Autenticação**: Um token pre-shared simples configurado no servidor via variável de ambiente `GEMINI_POC_WORKER_TOKEN`.
4. **Transcript-only worker**: worker remoto no container oficial busca e persiste transcripts sem fazer chamadas de AI, promovendo `analysis_jobs.awaiting_transcript` para `ready` mesmo quando o budget oficial está pausado.
5. **Feeder oficial**: consome somente `analysis_jobs.status='ready'`, seleciona o transcript persistido mais recente, respeita recência e cria `gemini_poc_jobs` idempotentemente.
6. **Operação**: o launcher local inicia um túnel de produção próprio, backend local, feeder, um único transcript worker remoto e exatamente uma aba Brave Gemini com `igd_poc_autostart=1&igd_worker_slot=prod-1`.

O script Tampermonkey/DOM do Gemini continua sendo operado no navegador e pode exigir intervenção humana para autenticação ou verificação; o launcher nunca tenta burlar CAPTCHA. O dashboard operacional está em `/admin/gemini-workers` e diferencia transcript pendente/processando, pronto para Gemini, fila/processamento Gemini, retries, falhas terminais e quarentena.

## Endpoints

* **`POST /claim`**: Recebe o `{ "workerId" }`. Retorna detalhes de um `gemini_poc_job` na fila ou renova um job já pertencente a este worker (garantindo que se a página foi atualizada, ele retoma o mesmo job). Fornece o `transcript`.
* **`POST /heartbeat`**: Recebe `{ "workerId", "jobId", "metrics" }` e atualiza as marcações no DB para indicar que o job e o worker ainda estão ativos.
* **`POST /complete`**: Recebe `{ "workerId", "jobId", "result" }`. O resultado é validado transacionalmente através do `AnalysisOutputSchema` canônico. Se válido, os resultados finais são gravados oficialmente nas tabelas `analysis_runs` e `analysis_attempts`, marcando como o modelo sendo `gemini-workspace-agent`. O `cost_usd` e `tokens` recebem *null/unavailable*, não se presumindo os dados de faturamento.
* **`POST /fail`**: Usado pelo Tampermonkey para avisar de falhas. De acordo com a flag `retryable`, o job volta à fila com timeout (para outro tentar pegar) ou vira `failed_terminal`.

## Lifecycle

1. `analysis_jobs.awaiting_transcript` é reclamado pelo transcript-only worker mais recente-primeiro, o Google Drive é consultado e o transcript é persistido.
2. O lifecycle oficial promove o job para `analysis_jobs.ready`.
3. O feeder cria um `gemini_poc_job` somente para esse job oficial pronto, exceto quando já houver análise current concluída ou histórico Gemini terminal para a call.
4. A única aba Brave configurada com Tampermonkey consulta `/claim` e envia `/heartbeat` para o job reclamado.
5. `failed_retryable` retorna o job à fila de Gemini; `failed_terminal` é auditado e o worker segue para a próxima call. Um job terminal não é reaberto automaticamente pelo feeder.
6. `/complete` valida a saída e conclui transacionalmente `gemini_poc_jobs`, `analysis_runs`, `analysis_jobs` e `calls`. Uma conclusão Gemini tardia não substitui uma análise current concorrente já concluída.

## Segurança

* O Worker (Navegador) interage apenas através de uma subrota isolada (`/api/poc/gemini/*`).
* Autenticação isolada via variável de ambiente `GEMINI_POC_WORKER_TOKEN`.
* A autorização atual (Cargos Organizacionais IGD ou Administradores Plataforma) não foi misturada com o Worker POC.
* Nenhuma transcrição real ou token é comitado no repositório.
* Os dados persistidos seguem idempotência por `(call_id, transcript_id)` e preservam histórico. Uma análise current concorrente já concluída não é sobrescrita por uma conclusão Gemini tardia.
* O Worker não afeta a tabela de controle financeiro do Vercel (`ai_budget_accounts`, `ai_cost_reservations`).

## Notas Adicionais

- O worker *oficial* no servidor e o enfileiramento via `n8n` ou `Vercel AI Gateway` não são afetados ou removidos.
- A POC atua como um sistema aditivo para explorar análises massivas de custo marginal zero caso sessões Workspace permitam volumes aceitáveis, sujeitas aos ToS do Google.

## Operação

Iniciar o POC de produção:

```bash
cd "/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc"
zsh scripts/gemini-production-run.command
```

O launcher usa `oracle-vps`, abre o túnel local `55433`, verifica `sales_intelligence`, obtém o token somente do Keychain e limpa apenas recursos identificados pelo seu `run_id`.

Status local do pipeline:

```bash
zsh scripts/gemini-production-status.command
```

Parada segura do run atual:

```bash
zsh scripts/gemini-production-stop.command
```

Watchers opcionais, sempre separados do launcher:

```bash
zsh scripts/gemini-shutdown-watcher.command --on-exit
zsh scripts/gemini-shutdown-watcher.command --on-gemini-failure
```

O watcher de falhas considera somente três eventos `failed_terminal` Gemini consecutivos sem um evento `completed` entre eles. Eventos `failed_retryable` e `claimed` não contam nem reiniciam a sequência. O cancelamento durante a janela de 60 segundos é `touch /tmp/gemini-cancel-shutdown`.
