# Ingestão manual e programática de calls

O importador recebe um JSON privado, valida o lote, resolve a identidade pelo Google Doc e grava a call, sua origem, a transcrição e os logs no PostgreSQL. O modo padrão é somente leitura; nenhuma análise é solicitada sem flags explícitas.

## Pré-requisitos

- migration `003_source_agnostic_ingestion.sql` aplicada;
- cada `seller_code` já cadastrado em `sellers`;
- `DATABASE_URL` somente no ambiente local/seguro;
- arquivo de entrada sob `private/`, que é ignorado pelo Git;
- para buscar o conteúdo de um Google Doc, um `GOOGLE_ACCESS_TOKEN` curto e com acesso ao arquivo; se `transcript_text` vier no lote, nenhuma credencial Google é necessária.

Nunca coloque transcrições, clientes, e-mails, tokens ou IDs privados nos arquivos versionados.

## 0. Cadastro controlado de vendedores

Sem a automação da planilha de times, importe primeiro o arquivo privado de vendedores no formato do exemplo sintético [sellers.synthetic.json](examples/sellers.synthetic.json). O dry-run mostra quantos códigos já existem:

```bash
DATABASE_URL='postgresql://...' \
SELLER_REGISTRY_FILE='private/sellers.json' \
npm run sellers:import
```

Depois da conferência, o `--apply` faz upsert somente pelos códigos `V###` informados:

```bash
npm run sellers:import -- --apply
```

Calls que apontem para um vendedor ausente são rejeitadas; vendedores históricos podem permanecer inativos sem perder suas calls. O importador de calls nunca inventa um cadastro.

## Contrato de entrada

O arquivo contém um array de até 100 itens:

```json
[
  {
    "transcript_url": "https://docs.google.com/document/d/1SYNTHETIC_file_001/edit",
    "transcript_file_id": "1SYNTHETIC_file_001",
    "transcript_text": "Transcrição sintética opcional.",
    "seller_code": "V999",
    "customer_name": "Cliente Sintético",
    "customer_email": "cliente@example.invalid",
    "product": "INSIDER",
    "call_date": "2026-01-02T12:00:00-03:00",
    "status": "NAO FECHOU",
    "origin": "Origem sintética",
    "source_type": "manual_crm_import",
    "source_external_id": "lote-sintetico-001:item-001",
    "source_uri": "https://example.invalid/lote-sintetico-001",
    "recording_url": "https://example.invalid/recording",
    "metadata": {}
  }
]
```

`transcript_file_id` e `transcript_url` podem ser enviados juntos; se divergirem, o item é rejeitado. `source_external_id` deve ser estável dentro da origem, por exemplo `nome-do-lote:item-0001`.

## 1. Dry-run obrigatório

```bash
DATABASE_URL='postgresql://...' \
MANUAL_INGESTION_FILE='private/calls.json' \
npm run calls:import
```

O relatório informa quantidade de itens, IDs únicos, duplicatas dentro do lote, calls já existentes, calls que seriam criadas e vendedores ausentes. O dry-run não cria calls, sources, transcrições, runs ou eventos.

## 2. Importação controlada

Depois de revisar o dry-run:

```bash
DATABASE_URL='postgresql://...' \
MANUAL_INGESTION_FILE='private/calls.json' \
npm run calls:import -- --apply
```

Sem `--request-analysis`, o processo para em `transcript_ready` (ou `metadata_ready` quando não recebeu nem conseguiu buscar texto). A importação registra `ingestion_runs` e eventos diagnósticos sem copiar PII para a mensagem do log.

Para exportar um Doc durante a importação, forneça `GOOGLE_ACCESS_TOKEN` apenas no ambiente do processo. Falhas de autorização são registradas como `FAILED_TRANSCRIPT_ACCESS` e podem ser repetidas depois.

## 3. Solicitar e executar análise

Enfileirar análise é uma ação separada e explícita:

```bash
npm run calls:import -- --apply --request-analysis
```

Isso apenas cria `analysis_runs` com status `queued`. Não chama IA. Se já houver análise oficial concluída para a call, a fila é ignorada.

O worker também começa em dry-run:

```bash
DATABASE_URL='postgresql://...' npm run analysis:process -- --limit=1
```

Para executar uma única análise com o Vercel AI Gateway:

```bash
DATABASE_URL='postgresql://...' \
AI_GATEWAY_API_KEY='...' \
AI_GATEWAY_PRIMARY_MODEL='openai/gpt-5.6-luna' \
AI_GATEWAY_ESCALATION_MODEL='openai/gpt-5.6-sol' \
AI_ANALYSIS_CONFIDENCE_THRESHOLD='0.5' \
AI_ANALYSIS_STRATEGY_VERSION='insider-cost-quality-v1' \
npm run analysis:process -- --apply --limit=1
```

O limite aceito é de 1 a 30. Cada resultado atravessa a mesma strategy usada em produção, é validado pelo schema, persiste os attempts e receipts, marca somente o resultado final como oficial e aparece automaticamente no dashboard. Os slugs e o threshold são configuração, não constantes espalhadas pelo worker.

## Retentativa e reanálise

- reenviar a mesma call com uma nova `source_type/source_external_id` reutiliza o mesmo `call_id`;
- reenviar a mesma origem atualiza `last_seen_at`;
- um fetch de transcrição que falhou pode ser repetido com o mesmo lote;
- uma análise falha pode ser novamente enfileirada com a mesma configuração;
- uma análise oficial concluída não é reenfileirada pela ingestão; a reanálise manual com nova versão/modelo fica reservada a um comando administrativo futuro e nunca apagará o histórico anterior.
