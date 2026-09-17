# Google Sheets e Drive API para Organization Sync

Pesquisa realizada em **2026-09-10**, exclusivamente na documentação oficial do Google. Esta nota valida o contrato HTTP do Organization Sync; não houve acesso à planilha real, credenciais ou IDs privados.

## Conclusão

O fluxo necessário é integralmente read-only e pode usar somente três requests `GET`:

1. `spreadsheets.get` para identificar a aba pelo `sheetId` e obter título e dimensões;
2. `spreadsheets.values.get` para ler `'<TAB_TITLE>'!A:N` por linhas, com valores calculados não formatados e datas formatadas;
3. `drive.files.get` para obter `modifiedTime` e `version` do arquivo.

Nenhum endpoint de escrita, corpo de request ou scope com permissão de escrita é necessário. Os dois métodos do Sheets declaram corpo vazio e aceitam `spreadsheets.readonly`; `files.get` também declara corpo vazio e aceita `drive.metadata.readonly`. [spreadsheets.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [spreadsheets.values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get), [Drive files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)

## Autorização OAuth

Após obter um access token para os scopes concedidos, o cliente deve enviá-lo no header `Authorization: Bearer <ACCESS_TOKEN>`; o Google recomenda o header em vez do query parameter porque query strings tendem a aparecer em logs. O refresh token deve permanecer em armazenamento seguro e serve para renovar access tokens de curta duração. [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server), [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

Contrato read-only explícito para os três requests:

- `https://www.googleapis.com/auth/spreadsheets.readonly` para os dois endpoints do Sheets;
- `https://www.googleapis.com/auth/drive.metadata.readonly` para o `files.get` de metadata.

`spreadsheets.readonly` é classificado como sensitive; `drive.metadata.readonly` é restricted. O Google orienta escolher o scope mais estreito possível. Um token com `drive.readonly` também autoriza os três endpoints, mas é mais amplo: permite ver e baixar todos os arquivos do Drive e é restricted. `drive.file` é a opção per-file recomendada pelo Google e também aparece entre os scopes aceitos pelos três métodos, porém depende de um fluxo em que o arquivo seja aberto/compartilhado com o app e concede capacidade de escrita sobre esse arquivo; portanto não é a escolha estritamente read-only para este daemon com planilha preconfigurada. [Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes), [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

Habilitar a Sheets API e a Drive API no projeto é necessário, mas não substitui os scopes concedidos nem o acesso do principal ao arquivo.

## Metadata da planilha e da aba

O request documentado é:

```http
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))
Authorization: Bearer <ACCESS_TOKEN>
```

`spreadsheets.get` retorna um recurso `Spreadsheet`, não inclui dados de grid por padrão e recomenda uma field mask com apenas os campos necessários. A sintaxe usada acima é válida: o próprio guia mostra `sheets.properties(sheetId,title,sheetType,gridProperties)`. [spreadsheets.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [Use field masks](https://developers.google.com/workspace/sheets/api/guides/field-masks)

Em `SheetProperties`, `sheetId` é um inteiro não negativo e imutável depois de definido, `title` é o nome da aba e `gridProperties` descreve grids. `rowCount` e `columnCount` são as dimensões/capacidade do grid, não a contagem de linhas preenchidas; `gridProperties` pode estar ausente para uma aba `OBJECT`. [SheetProperties and GridProperties](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets)

## Leitura de `A:N`

A leitura documentada é:

```http
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/'<TAB_TITLE>'!A:N?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING
Authorization: Bearer <ACCESS_TOKEN>
```

`A:N` é uma range A1 válida para todas as células das colunas A até N; qualificar e citar o título da aba evita depender da primeira aba visível e é necessário para nomes com espaços ou caracteres especiais. O `sheetId` é estável mesmo se o nome mudar, então resolver o título atual via metadata antes da leitura é coerente. [Sheets concepts and A1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts)

Com `majorDimension=ROWS`, o array externo representa linhas. `UNFORMATTED_VALUE` devolve o resultado calculado sem a formatação da célula; números permanecem números. Como `valueRenderOption` não é `FORMATTED_VALUE`, `dateTimeRenderOption=FORMATTED_STRING` é aplicado e devolve datas, horas e durações como strings segundo o formato e locale da planilha. [spreadsheets.values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get), [ValueRenderOption](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption), [DateTimeRenderOption](https://developers.google.com/workspace/sheets/api/reference/rest/v4/DateTimeRenderOption)

O `ValueRange` omite linhas e colunas vazias no final. Portanto, a quantidade de arrays recebidos não deve ser comparada diretamente com `gridProperties.rowCount`, e linhas internas podem ter menos de 14 elementos quando suas células finais estão vazias. [ValueRange](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values)

## Metadata de revisão no Drive

O request documentado é:

```http
GET https://www.googleapis.com/drive/v3/files/{spreadsheetId}?fields=id,modifiedTime,version
Authorization: Bearer <ACCESS_TOKEN>
```

`files.get` recupera metadata por file ID e aceita o parâmetro `fields` para limitar a resposta. `modifiedTime` é o último horário em que qualquer pessoa modificou o arquivo, em RFC 3339. `version` é um `int64` serializado como string, somente de saída e monotonicamente crescente; reflete toda mudança no servidor, inclusive mudanças não visíveis ao usuário. [Drive files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get), [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter)

`version` é um marcador de mudança do arquivo, não um revision ID imutável nem uma garantia de que apenas os valores de A:N mudaram. No domínio, um nome como `source_version` é mais preciso que tratar esse valor como uma revisão recuperável.

## Conferência com o Organization Sync atual

O cliente atual está alinhado com o contrato oficial: usa os três endpoints `GET`, o header Bearer, as field masks esperadas, identifica a aba pelo `sheetId`, lê `A:N` com as opções corretas e não chama nenhum endpoint do grupo de escrita.

Pontos a explicitar na configuração/documentação operacional:

- o refresh token existente precisa ter autorização efetiva para **Sheets read-only e Drive metadata**; habilitar as APIs, por si só, não concede esses scopes;
- o campo atualmente chamado `revision` contém o `File.version` do Drive, não uma revisão baixável do Sheets;
- `rowCount`/`columnCount` descrevem a capacidade do grid, enquanto `values` omite vazios finais;
- não houve validação live de consentimento, ACL, resposta ou dados da planilha nesta pesquisa.
