# Primeiro lote INSIDER

Este fluxo importa um JSONL privado sem buscar transcrições em massa e produz uma fila determinística e equilibrada entre vendedores.

## Garantias

- `transcript_file_id` continua sendo a identidade canônica;
- metadata import e transcript fetch são etapas separadas;
- registros sem data ou cliente são preservados como ausentes, sem valores inventados;
- associações ambíguas de vendedor ficam em `needs_review` e não entram na fila automática;
- vendedores históricos podem permanecer inativos e suas calls continuam catalogadas;
- a fila prioriza closers INSIDER ativos da fonte oficial;
- nenhuma análise é executada pelo importador ou pelo seletor.

## Validação

```bash
MANUAL_INGESTION_FILE='private/insider-calls.jsonl' npm run insider:validate
```

O validador confere JSON/shape, identidade explícita versus URL, unicidade, sources agregadas, cobertura, datas, e-mails e divergências de vendedor.

## Vendedores

Exporte a aba oficial como CSV somente no ambiente e gere o arquivo privado:

```bash
MANUAL_INGESTION_FILE='private/insider-calls.jsonl' \
SELLER_REGISTRY_CSV_URL='https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=...' \
SELLER_REGISTRY_FILE='private/insider-sellers.json' \
npm run insider:prepare-sellers
```

Depois execute `sellers:import` primeiro em dry-run e só então com `--apply`.

## Catálogo

```bash
DATABASE_URL='postgresql://...' \
MANUAL_INGESTION_FILE='private/insider-calls.jsonl' \
npm run insider:catalog
```

Após conferir o relatório, acrescente `-- --apply`. O apply é uma única transação: qualquer falha inesperada desfaz todo o catálogo. Cada ocorrência agregada em `sources` cria ou atualiza sua própria `call_source`; o transcript não é acessado.

## Seleção fair/round-robin

```bash
DATABASE_URL='postgresql://...' \
MANUAL_INGESTION_FILE='private/insider-calls.jsonl' \
ANALYSIS_QUEUE_FILE='private/insider-analysis-queue.json' \
npm run insider:select-queue
```

Dentro de cada vendedor, a ordem é data válida descendente e depois `source_row` descendente. O fallback foi adotado somente após validar correlação positiva entre row e data nas abas com ambos os campos. A fila intercala um item de cada vendedor antes do round seguinte e exclui análise oficial existente ou associação de vendedor em revisão.

## Fetch e análise

O fetch recebe somente candidatos da fila até obter o tamanho controlado do lote. Eventos `TRANSCRIPT_FETCH_STARTED`, `TRANSCRIPT_FETCHED` e `FAILED_TRANSCRIPT_ACCESS` registram o ciclo sem colocar conteúdo nos logs.

O worker `analysis:process` exige `--apply`, limita cada execução a no máximo 30 itens e persiste tokens, custo calculado pela tabela vigente do Gateway e latência. A primeira execução real também é o gate do Gateway: erros globais 401/403 encerram imediatamente o lote e deixam os demais runs na fila. Um lote maior deve ser dividido deliberadamente.
