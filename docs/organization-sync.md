# Organization Sync

O Organization Sync lê a aba oficial **Registro de vendedores e times** com o OAuth Google server-side existente e publica somente snapshots válidos no PostgreSQL. Ele não usa n8n, service account, CSV nem IA, e nunca escreve no Google Sheets.

## Cargo canônico

A planilha atual expressa Closer e SDR diretamente em **Cargo**. As demais responsabilidades são derivadas de campos estruturais já existentes, sem inferência por nome:

1. `Supervisor = TRUE` → Supervisor;
2. `Líder em treinamento = TRUE` → Líder em treinamento;
3. código V referenciado em `Código do líder` → Líder;
4. `Cargo = Closer`, `SDR` ou `Administrador` → cargo correspondente.

Supervisor tem precedência sobre as demais responsabilidades e Líder em treinamento tem precedência sobre Líder/Cargo. Se Supervisor e Líder em treinamento aparecem simultaneamente, se um booleano é inválido ou se Cargo não pertence ao vocabulário aprovado, o cargo anterior é preservado e um aviso auditável é registrado. `PLATFORM_ADMIN` e qualquer coluna externa semelhante são ignorados: a organização nunca concede Administração da Plataforma.

Cada mudança encerra o intervalo anterior em `person_organization_roles` e inicia um novo no instante observado. Uma conta de origem Organização IGD vinculada não precisa ser editada; seu próximo request recebe o cargo e a abrangência vigentes. Contas de origem Manual não são alteradas. Quando uma identidade manual passa a ter correspondência organizacional única, a gestão de usuários apenas apresenta a sugestão de vínculo; a mudança de origem exige confirmação explícita e evento de auditoria.

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

O comando renova OAuth, lê metadata, revision, aba e valores, valida headers e imprime somente título, contagens, warnings e estados OK/FAIL. Com `--plan`, também separa transições do grafo organizacional de mudanças de Acesso Efetivo das contas Organização IGD; contas Manuais ficam fora dessa segunda contagem. Ele não publica e faz zero requests de IA.

## Publicação controlada

```bash
npm run organization:sync -- --apply
```

Antes de usar `--apply` em produção, obtenha backup restaurável, aplique apenas migrations incrementais e rode o modo read-only. O daemon usa:

```bash
npm run organization:sync -- --apply --daemon
```

## Fail-closed e remoções

O pipeline é `fetch → parse → validate → snapshot → diff → sanity checks → transaction`. Header obrigatório ausente, leitura vazia, conflito canônico ou queda de pessoas ativas acima do limite rejeita a publicação. Linhas ruins viram avisos quando o restante continua confiável. Ausência de uma pessoa em uma leitura não a inativa nem revoga cargos; sinal de cargo inválido preserva o cargo vigente inteiro, evitando um recálculo parcial. Identidade de líder ausente/desconhecida preserva a liderança boa dos times afetados. `Ativo = FALSE` explícito preserva a Person e encerra suas relações atuais e seu acesso derivado.

Depois que uma Person recebe `organizationManaged=true`, o trigger legado de `sellers` resolve primeiro o V-code já existente e deixa de alterar seu código, nome e status. Assim, ingestão rotineira de calls liga o Seller à Person canônica sem duplicá-la nem reativar alguém que a fonte organizacional marcou como inativo. Times legados só são reconciliados por nome quando ainda não possuem frente; times homônimos já classificados em frentes diferentes permanecem distintos, e um único time legado potencialmente reivindicado por várias frentes rejeita o candidate inteiro.

Cada execução persiste status, títulos da fonte/aba, revisão técnica, contagens, códigos de aviso, ator quando manual e resumo do diff. `organization_change_events` registra por que vínculo de time, liderança ou cargo iniciou/terminou sem armazenar credenciais. Pessoas e Times aceitam uma data compartilhável: a composição usa a vigência temporal e, quando a data é informada, as métricas incluem apenas calls daquele dia usando a atribuição histórica gravada.

## Produtos analíticos

FL e INSIDER participam da navegação, filtros e listagens analíticas. Ingressos continua sincronizado em Produtos, Frentes, Times, Pessoas e histórico, mas usa `analytics_enabled = false`; portanto não aparece como área analítica nem pode ser escolhido como abrangência de acesso. Essa separação não apaga nem reorganiza dados de Ingressos.
