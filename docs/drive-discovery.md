# Drive discovery

## Fluxo

```text
Google Drive OAuth
  -> Shared with me inventory
  -> enabled source roots
  -> bootstrap tree / Changes API
  -> drive_documents
  -> deterministic identification and attribution
  -> calls + call_sources
  -> existing analysis_jobs worker
```

`source_locations` foi evoluída como registro de roots. Pastas novas vistas em `Shared with me` entram como `candidate`; somente uma ação administrativa explícita as torna `enabled`. Documentos compartilhados diretamente são catalogados no inbox lógico, sem transformar todo o Drive em fonte confiável.

`drive_documents.google_file_id` é a identidade. Rename e move atualizam metadata do mesmo registro. Shortcuts guardam provenance, mas o alvo é catalogado por `shortcutDetails.targetId`.

## Modos de discovery

- Primeira execução: captura o start page token, percorre recursivamente roots habilitadas e só então persiste o cursor.
- Incremental: consome todas as páginas de `changes.list`, preserva removidos/inacessíveis e revarre apenas roots afetadas.
- Recuperação: roots sem reconciliação recente recebem full scan; o padrão é diário.

Uma reconciliação completa desativa apenas a relação source/documento que não reapareceu; o documento e qualquer Call associada são preservados. Se a travessia contém erro parcial, essa desativação é adiada para evitar falso negativo.

O daemon usa lease global e lease por source. PostgreSQL unique constraints permanecem a última barreira contra duplicação concorrente.

## Identificação e attribution

Classificação básica segue MIME type, nome, source/pastas, metadata e somente então conteúdo. Não há chamada de IA nessa versão. Google Docs, `text/plain` e VTT podem receber identificação por amostra de conteúdo; PDF fica em `needs_review` até existir um parser explícito e não é enviado ao fetcher textual. Attribution prioriza `seller_code`, e-mail e alias quando ligados explicitamente ao responsável. Owner/modificador não identificam o Primary Closer nem viram participantes; participantes são extraídos do conteúdo e o responsável é uma decisão separada. Contexto de pasta é evidência inferior. Empate ou falta de membership temporal produz `needs_review`, preservando método, origem da evidência e candidate person IDs sem guardar valores, nomes ou trechos da transcrição na provenance.

Call time prioriza timestamp real em header rotulado, metadata estruturada, nome/metadata, `createdTime` e por último `modifiedTime`. Datas citadas livremente no diálogo não são tratadas como horário real. Método, confiança e conflitos ficam persistidos.

## Segurança operacional

Defaults:

```text
DRIVE_DISCOVERY_INTERVAL_MS=300000
DRIVE_DISCOVERY_FULL_SCAN_INTERVAL_MS=86400000
DRIVE_DISCOVERY_CONTENT_READ_LIMIT=0
DRIVE_DISCOVERY_PERSIST_TRANSCRIPTS=false
DRIVE_DISCOVERY_AUTO_QUEUE=false
```

Assim, deploy e bootstrap inicial catalogam sem disparar análises. Novas Calls do discovery persistem `analysis_eligible=false`, portanto nem um restart do worker e seu `syncCatalog()` furam o checkpoint. Um ciclo posterior explicitamente autorizado com `DRIVE_DISCOVERY_AUTO_QUEUE=true` detecta roots que ainda contêm Calls inelegíveis, revisita esses vínculos, torna a Call elegível e cria o job sem esperar o full scan diário. Habilitar leitura, persistência ou fila deve ser uma decisão operacional separada. O daemon não registra tokens, conteúdo, nomes de arquivos, IDs do Drive ou participantes em stdout; logs contêm somente contadores e códigos sanitizados.

Comandos:

```bash
npm run drive:discover
npm run drive:discover -- --apply
npm run drive:discover -- --apply --full-scan
npm run drive:discover -- --apply --validate-read
npm run drive:report
npm run drive:sources -- --list
npm run drive:sources -- --source=<database-uuid> --enable
```

O primeiro comando é read-only. `--validate-read` limita a leitura a pelo menos um candidate e não persiste a transcrição nem enfileira análise enquanto os respectivos envs permanecerem `false`.
