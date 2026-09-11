# Organization Sync

O Organization Sync lê a planilha organizacional oficial com o OAuth Google server-side existente e publica somente candidates válidos no PostgreSQL. Ele não usa n8n, service account, CSV nem IA, e nunca escreve no Google Sheets.

## Configuração

Defina no ambiente seguro, sem versionar valores:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REFRESH_TOKEN`
- `ORGANIZATION_SPREADSHEET_ID`
- `ORGANIZATION_SHEET_ID`
- `ORGANIZATION_SYNC_INTERVAL_MS` (opcional; default `300000`)
- `DATABASE_URL` para comparação `--plan` e publicação `--apply`

O projeto OAuth precisa ter Google Sheets API e Google Drive API habilitadas e o principal OAuth deve conseguir ler a planilha. Um erro `google_sheets_access_denied` indica API não habilitada ou falta de permissão; nenhum token é registrado.

## Validação read-only

```bash
npm run organization:sync

# comparar o candidato com o PostgreSQL sem gravar
npm run organization:sync -- --plan
```

O comando renova OAuth, lê metadata, revision, aba e valores, valida headers e imprime somente título, contagens, warnings e estados OK/FAIL. Ele não exige banco, não publica e faz zero requests de IA.

## Publicação controlada

```bash
npm run organization:sync -- --apply
```

Antes de usar `--apply` em produção, obtenha backup restaurável, aplique apenas migrations incrementais e rode o modo read-only. O daemon usa:

```bash
npm run organization:sync -- --apply --daemon
```

## Fail-closed e remoções

O pipeline é `fetch → parse → validate → candidate → diff → sanity checks → transaction`. Header obrigatório ausente, leitura vazia, conflito canônico ou queda de pessoas ativas acima do limite rejeita a publicação. Linhas ruins viram warnings quando o restante continua confiável. Ausência de uma pessoa em uma leitura não a inativa; `Ativo = FALSE` explícito preserva a Person e encerra suas relações atuais.

Cada run persiste status, source revision/modified time, contagens, warning codes e resumo do diff. `organization_change_events` registra por que membership, leadership ou role iniciou/terminou sem armazenar credenciais.
