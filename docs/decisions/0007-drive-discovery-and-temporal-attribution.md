# ADR 0007 — Discovery do Drive e atribuição organizacional temporal

## Status

Aceita em 2026-09-10.

## Decisão

O aplicativo passa a descobrir arquivos com o OAuth Google existente: inventaria `Shared with me`, monitora somente roots explicitamente habilitadas, faz bootstrap recursivo, usa Changes API com cursor persistido para o incremental e reconcilia a árvore periodicamente. Um `Drive Document` existe antes de uma `Call`; seu ID canônico é o file ID do documento-alvo, enquanto nome, caminho, link e shortcut são provenance mutável.

`people` é a identidade canônica e `sellers` permanece como perfil comercial compatível. Attribution segue evidências determinísticas antes de IA, preserva provenance/ambiguidade para revisão e separa participantes de Primary Closer. Team Membership e Team Leadership são temporais; a Call preserva a membership válida em `call_started_at`. Para calls legadas sem histórico reconstruível, `team_id` permanece desconhecido e `legacy_team_snapshot_id` congela apenas o fallback de autorização/exibição existente na migration, sem alegar validade histórica. Calls legadas e descobertas pelo Drive continuam cruzando a mesma garantia `calls.transcript_file_id` + `call_sources`; essa reconciliação ocorre antes de exigir uma membership nova.

## Consequências

Discovery não solicita análise por padrão. A autorização durável `calls.analysis_eligible` impede que o `syncCatalog()` do worker enfileire uma nova Call antes do checkpoint explícito, e o budget guard continua sendo a segunda barreira. Conteúdo só é lido depois da classificação determinística. Perda de acesso, lixeira ou `removed=true` preserva catálogo e histórico como inacessível, sem criar score zero nem abortar o scan inteiro.
