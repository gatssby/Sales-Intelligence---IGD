# Google Drive API v3 para descoberta de transcrições

Pesquisa realizada em **2026-09-10**, exclusivamente na documentação oficial do Google Drive API v3. O objetivo é fundamentar a descoberta de documentos; esta nota não valida credenciais, pastas ou dados reais.

## Decisão recomendada

Adotar uma estratégia híbrida e recuperável:

1. cadastrar explicitamente as pastas-raiz monitoradas;
2. fazer um bootstrap recursivo e idempotente dessas raízes;
3. usar a Changes API para o fluxo incremental;
4. executar uma reconciliação recursiva completa, menos frequente, como mecanismo de reparo.

O bootstrap não deve tratar todo `Shared with me` como domínio do produto. `sharedWithMe` é um termo booleano de busca que representa os arquivos na coleção “Compartilhados comigo” do usuário; ele serve para localizar raízes candidatas, que só passam a ser monitoradas após registro explícito. Uma pasta é um `File` com MIME type `application/vnd.google-apps.folder`, e os filhos diretos são listados com `'<FOLDER_ID>' in parents and trashed = false`. A recursão é responsabilidade do cliente. [Search query terms](https://developers.google.com/workspace/drive/api/guides/ref-search-terms), [Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files), [Folders](https://developers.google.com/workspace/drive/api/guides/folder)

A Changes API é o mecanismo oficial eficiente para acompanhar mudanças, inclusive em arquivos compartilhados com o usuário. Ela captura estados que um polling por `modifiedTime` não representa com segurança, sobretudo perda de acesso e remoção. Como o change feed não aceita filtro arbitrário por pasta, o sistema ainda precisa filtrar as mudanças contra as raízes e a ancestralidade já catalogada. A reconciliação periódica corrige qualquer desvio de cursor, ancestralidade ou compartilhamento. [Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes), [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)

## Descoberta inicial

### Inventário de fontes

Use `files.list` no espaço `drive` com:

```text
q = sharedWithMe = true and trashed = false
corpora = user
spaces = drive
supportsAllDrives = true
includeItemsFromAllDrives = true
```

O resultado é somente um inventário administrativo de candidatos. O scanner automático deve aceitar apenas roots habilitadas no PostgreSQL, identificadas por file ID, sem depender do nome da pasta. Para uma root dentro de um Shared Drive conhecido, prefira `corpora=drive` e `driveId=<SHARED_DRIVE_ID>` em vez de `allDrives`; o Google recomenda `user` ou `drive` por eficiência, e uma consulta `allDrives` pode retornar `incompleteSearch=true`. [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)

### Travessia recursiva

Para cada pasta registrada, liste todas as páginas de filhos diretos:

```text
q = '<ROOT_OR_FOLDER_FILE_ID>' in parents and trashed = false
spaces = drive
supportsAllDrives = true
includeItemsFromAllDrives = true
```

No Drive API v3 atual, `parents` é uma coleção no recurso, mas um arquivo só pode ter uma pasta-pai. Ainda assim, armazenar o valor recebido como metadata/provenance evita acoplar o domínio ao caminho. [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [Folders](https://developers.google.com/workspace/drive/api/guides/folder)

`files.list` inclui itens na lixeira por padrão, portanto `trashed=false` precisa ser explícito. `pageSize` aceita no máximo 1.000 itens; deve-se seguir `nextPageToken` até ele desaparecer. Se um token de `files.list` for rejeitado, a orientação oficial é descartá-lo e reiniciar a paginação desde a primeira página. [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)

### Partial response

O Drive retorna apenas um subconjunto padrão. Para evitar chamadas adicionais e excesso de dados, o scanner deve pedir uma máscara explícita, por exemplo:

```text
nextPageToken,incompleteSearch,
files(
  id,name,mimeType,parents,driveId,trashed,
  createdTime,modifiedTime,sharedWithMeTime,version,
  webViewLink,resourceKey,
  shortcutDetails(targetId,targetMimeType,targetResourceKey),
  owners(displayName,emailAddress),
  sharingUser(displayName,emailAddress),
  lastModifyingUser(displayName,emailAddress),
  capabilities(canDownload,canListChildren)
)
```

As máscaras reduzem processamento, mas `nextPageToken` precisa constar explicitamente para a paginação funcionar. [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter), [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)

## Identidade, rename, move e shortcuts

O `File.id` é a identidade canônica. A documentação o define como único, opaco e estável durante a vida do arquivo, mesmo se o nome mudar. O nome não é único. Um move altera `parents` por `files.update`, usando `addParents` e `removeParents` no mesmo `fileId`. Logo:

- `transcript_file_id` deve ser o file ID do documento real;
- `name`, `parents` e `webViewLink` são snapshots mutáveis, nunca chaves;
- rename e move atualizam o registro existente;
- nenhuma mudança de nome ou pasta deve criar outra call.

[Files and folders overview](https://developers.google.com/workspace/drive/api/guides/about-files), [files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update), [Folders](https://developers.google.com/workspace/drive/api/guides/folder)

Um shortcut é outro `File`, com MIME type `application/vnd.google-apps.shortcut`, identidade própria e `shortcutDetails.targetId` apontando para o alvo. Seu nome evolui independentemente do alvo e `targetMimeType` é apenas um snapshot que pode ficar obsoleto. A decisão recomendada é:

- registrar o shortcut como provenance/ocorrência;
- resolver o alvo com `files.get(targetId)`;
- classificar e deduplicar o documento pelo `targetId`;
- se o alvo for uma pasta, percorrê-la com um conjunto de file IDs visitados para impedir ciclos;
- tratar shortcut quebrado como inacessível, sem apagar histórico.

O `targetResourceKey` pode precisar acompanhar o acesso a um alvo protegido por resource key. [Shortcuts](https://developers.google.com/workspace/drive/api/guides/shortcuts), [Resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys)

## Descoberta incremental com Changes API

Algoritmo recomendado para não perder alterações ocorridas durante o bootstrap:

1. obter e persistir provisoriamente um token com `changes.getStartPageToken`;
2. executar o scan recursivo completo e fazer upsert por file ID;
3. consumir `changes.list` desde aquele token;
4. seguir `nextPageToken` até o fim;
5. somente depois de aplicar as mudanças com sucesso, substituir o cursor por `newStartPageToken`.

`newStartPageToken` só aparece no fim da lista atual. Ao contrário dos tokens de `files.list`, os page tokens da Changes API não expiram. O cursor deve avançar na mesma transação lógica que persiste os efeitos do lote, para que retry seja seguro. [changes.getStartPageToken](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/getStartPageToken), [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)

Para o feed do usuário, use `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, `includeRemoved=true`, `spaces=drive` e não use `restrictToMyDrive=true`, pois essa opção omite arquivos compartilhados que não foram adicionados ao My Drive. Para um Shared Drive isolado, passe também `driveId` e mantenha um cursor próprio. [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list), [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)

Cada mudança traz `fileId` e, enquanto o arquivo continua acessível, o estado atualizado de `file`. `removed=true` significa que o item saiu da coleção por exclusão ou perda de acesso; nesses casos, `file` pode não existir. O catálogo deve então marcar o registro conhecido como removido/inacessível e preservar provenance, call e histórico. [Change resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes)

Para cada mudança acessível:

- se o file ID já é conhecido, atualize metadata e reavalie o estado necessário;
- se o pai é uma pasta conhecida da source, catalogue o novo item;
- se uma pasta nova ou movida entrou na source, percorra sua subárvore;
- se o item foi movido para fora, preserve o registro e marque sua relação atual com a source;
- para mudanças desconhecidas, resolva ancestralidade por IDs, nunca por nomes.

Um lock/lease no PostgreSQL por scanner ou source e constraints únicas por identidade canônica devem impedir concorrência duplicada. Uma reconciliação completa diária ou administrativa mantém a operação recuperável sem polling agressivo.

### Trade-off

| Opção | Vantagem | Limitação | Recomendação |
|---|---|---|---|
| Revarrer toda a árvore a cada poucos minutos | Implementação inicial simples; naturalmente idempotente | Custo cresce com a árvore; não representa bem perda de acesso; repete listagens | Usar no bootstrap e como reparo menos frequente |
| Polling por `modifiedTime` | Fácil de consultar | Watermark e ancestralidade são frágeis; itens que ficaram inacessíveis desaparecem das buscas; `modifiedTime` não é data da call | Não usar como mecanismo definitivo |
| Changes API | Eficiente; entrega estado atualizado, rename/move e `removed` | Feed é amplo e não filtra por root; exige cursor transacional e filtro local | Usar como incremental principal |
| Híbrido | Eficiência diária com caminho de recuperação determinístico | Pequeno custo adicional de dois modos de scan | **Escolha recomendada** |

## Metadata temporal

`createdTime` é o horário de criação do arquivo; `modifiedTime` é a última modificação feita por qualquer pessoa. Nenhum dos dois é, por contrato, o horário da call. Portanto:

- timestamp real ou metadata estruturada da reunião devem prevalecer;
- `createdTime` é um fallback razoável com provenance e confiança reduzida;
- `modifiedTime` deve ser o último fallback e nunca substituir uma data real já resolvida;
- ordenação do Drive não deve definir prioridade da fila; a prioridade deve ser calculada no PostgreSQL a partir de `call_started_at` ou do melhor timestamp disponível.

[File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [files.list ordering](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)

## Permissões, capabilities e Shared Drives

`capabilities` descreve as ações disponíveis para o usuário autenticado e é derivado das permissões. Verifique `capabilities.canListChildren` para folders e `capabilities.canDownload` antes de ler conteúdo. Mesmo assim, falhas 403/404 devem ser isoladas por documento: um item inacessível não deve abortar o scan. [File metadata](https://developers.google.com/workspace/drive/api/guides/file-metadata), [Download and export](https://developers.google.com/workspace/drive/api/guides/manage-downloads)

Não use ACL ou owner como pré-condição de catalogação nem como única evidência de attribution:

- `permissions[]` no recurso `File` só traz a lista completa quando o usuário pode compartilhar e não é preenchido para itens em Shared Drives;
- `owners[]` não é preenchido para itens em Shared Drives;
- permissões podem ser herdadas e mudar quando a hierarquia muda;
- `sharingUser`, `owners`, `lastModifyingUser` e permissions são evidências oportunistas, não identidade de participante ou closer.

[File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [Permissions resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions), [Share files, folders and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing)

Inclua `supportsAllDrives=true` em `files.get/list`, `changes.getStartPageToken/list` e `permissions.get/list`. Em listagens que podem incluir Shared Drives, use também `includeItemsFromAllDrives=true`. Evite `allDrives` quando `user` ou um `driveId` conhecido resolverem o caso. [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)

## Leitura mínima de conteúdo

Faça classificação determinística por MIME type, source, nome e metadata antes de ler o documento. Só candidatos plausíveis devem ter conteúdo acessado.

- Para arquivos blob no Drive, use `files.get(fileId, alt=media)`.
- Para Google Docs (`application/vnd.google-apps.document`), use `files.export(fileId, mimeType=text/plain)`.
- Google Docs suporta oficialmente `text/plain`; a exportação por `files.export` tem limite de 10 MB.
- `files.export` entrega o conteúdo exportado; a documentação não promete leitura parcial por range. Portanto, não baseie o design em partial export.
- Scopes de metadata não autorizam leitura do conteúdo; o refresh token existente precisa ter um scope que permita download/export.

[Download and export files](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [files.export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export), [Export MIME types](https://developers.google.com/workspace/drive/api/guides/ref-export-formats), [OAuth scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

Erros de download/export devem produzir estado `inaccessible` ou equivalente no registry, com retry controlado, sem conteúdo em logs e sem transformar a ocorrência em score zero.

## Implicações para o Sales Intelligence

| Requisito | Consequência arquitetural |
|---|---|
| Identidade canônica | Unique key pelo ID do documento-alvo; shortcut é provenance |
| Rename/move | Upsert do mesmo registro e atualização de metadata |
| Múltiplas origens | CRM e Drive reconciliam pelo mesmo `transcript_file_id` |
| Catálogo antes de call | Documento pode existir como discovered/candidate/inaccessible sem `call_id` |
| Data da call | `createdTime`/`modifiedTime` carregam método e confiança; não são verdade de domínio |
| Attribution | Owner, sharing user e caminho são evidências auxiliares, nunca decisão arbitrária |
| Incremental | Cursor da Changes API persistido após aplicação idempotente |
| Recuperação | Scan recursivo periódico e status preservado para removidos/inacessíveis |
| Concorrência | Lock/lease e constraints únicas no PostgreSQL |
| Custos | Discovery/classificação básica não chama IA; leitura só para candidatos |

## Fontes oficiais principais

- [Google Drive API v3](https://developers.google.com/workspace/drive/api/reference/rest/v3)
- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files)
- [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)
- [Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- [Shortcuts](https://developers.google.com/workspace/drive/api/guides/shortcuts)
- [Download and export files](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Export MIME types](https://developers.google.com/workspace/drive/api/guides/ref-export-formats)
