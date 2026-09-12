# ADR 0009 — Platform Admin e Preview Mode somente leitura

## Status

Aceita em 2026-09-10; a lista de personas e a origem do Administrador comercial foram ampliadas pelo [ADR 0010](0010-organizational-cargo-and-derived-access.md).

## Contexto

O System Role Admin acumulava governo comercial e detalhes úteis apenas para manutenção técnica. Isso aumentava ruído para a operação e não oferecia uma forma fiel e segura de o mantenedor verificar a experiência de cada escopo organizacional.

## Decisão

- `PLATFORM_ADMIN` é um System Role explícito, global e interno. Ele herda as capacidades comerciais de Admin e acrescenta `platform:observe`, `platform:operate` e `preview:use`.
- `ADMIN` permanece global nos dados comerciais, em integridade operacional e na gestão de contas e vínculos, sem endpoints ou detalhes técnicos exclusivos da plataforma.
- A migration apenas amplia o domínio permitido de `app_users.role`; não promove, duplica ou altera Admins existentes.
- Organization Sync não lê nem escreve System Roles. A promoção inicial reutiliza uma conta Admin ativa por um comando interno explícito, preserva seu `user_id`, revoga sessões e registra auditoria. O fluxo comercial de usuários nunca oferece nem aceita `PLATFORM_ADMIN`.
- Diagnósticos técnicos são expostos por um read model sanitizado e uma área Platform agrupada. Tokens, secrets, cursores, conteúdo bruto de environment variables e erros brutos não pertencem à interface; somente presença, estado, timestamps, contagens, versões e códigos normalizados.
- Preview Mode não cria sessão nem token de impersonation. Um cookie HTTP-only guarda apenas o papel/persona selecionado; cada request revalida que o ator real continua sendo Platform Admin e resolve novamente o Effective Access no PostgreSQL. Falha nessa resolução conserva um preview sem capacidades e sem escopo até saída explícita, nunca restaura autoridade silenciosamente.
- O `AuthorizationContext` preserva `userId`, e-mail e `role` do ator real. Durante preview, `accessRole`, capacidades e scope representam a visão simulada, enquanto `preview` registra o Preview Subject.
- Todo preview é somente leitura. O guard central de mutation é aplicado também nos repositórios administrativos, e endpoints técnicos perdem suas capacidades no contexto simulado. Iniciar e encerrar preview registram o Platform Admin real como ator.
- Mutações da conta e das credenciais do Platform Admin também são protegidas no PostgreSQL. Bootstrap e troca da própria senha usam uma autorização local à transação, o que mantém versões anteriores seguras durante deploy/rollback. A promoção exige que a conta Admin já tenha concluído a troca de senha temporária.

## Consequências

Admin comercial vê menos informação interna sem perder decisões operacionais. O mantenedor consegue validar navegação, filtros, páginas, empty states e dados com o mesmo Effective Access usado pelo produto, sem agir em nome da persona. Novas mutations devem usar o guard central para permanecer bloqueadas em Preview Mode.
