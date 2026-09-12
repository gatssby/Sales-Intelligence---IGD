# Autenticação e controle de acesso

## Matriz canônica

O PostgreSQL calcula o cargo e a abrangência em cada leitura. A interface pode selecionar apenas um recorte dentro dessa abrangência; parâmetros de URL e campos enviados pelo navegador nunca ampliam acesso.

| Cargo ou autoridade exibida | Origem | Abrangência | Calls e análises | Usuários e vínculos | Configurações comerciais | Operação técnica / IA paga |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Closer | organização oficial ou Manual | própria Pessoa | Sim | Não | Não | Não |
| SDR | organização oficial ou Manual | própria Pessoa | Sim | Não | Não | Não |
| Líder | organização oficial ou Manual | Times derivados ou selecionados | Sim | Não | Não | Não |
| Líder em treinamento | organização oficial ou Manual | Times derivados ou selecionados | Sim | Não | Não | Não |
| Supervisor | organização oficial ou Manual | Produto derivado ou selecionado | Sim | Não | Não | Não |
| Administrador | organização oficial ou Manual | toda a operação comercial | Sim | Sim | Sim | Não |
| Administrador da Plataforma | concessão interna explícita | operação comercial e Plataforma globais | Sim | Sim | Sim | Sim |

Contas comerciais novas escolhem uma origem explícita. `ORGANIZATION` resolve `CLOSER`, `SDR`, `LEADER`, `LEADER_IN_TRAINING`, `SUPERVISOR` ou `ADMIN` pela Person vinculada e pelo grafo temporal. `MANUAL` persiste diretamente o mesmo perfil e somente o tipo de escopo permitido para ele. `PLATFORM_ADMIN` é uma autoridade separada, não um Cargo Organizacional nem um perfil concedido pela área comercial.

## Gestão de contas

Em **Usuários e acessos**, o Administrador escolhe primeiro **Organização IGD** ou **Manual**. Organização IGD exige uma Pessoa publicada e não oferece escopo editável. Manual exige um perfil e apenas seu vínculo compatível: Pessoa para Closer/SDR (inclusive criação de identidade analítica sintética), um ou mais Times para Líder/Líder em treinamento, exatamente um Produto para Supervisor e nenhum recorte para Administrador. A tela mostra origem, cargo/perfil, vínculo e abrangência calculada.

Contas históricas `USER`, `LEADER`, `SUPERVISOR` e `SALES_OPS` continuam reconhecidas para rollback. A migração converte para `ORGANIZATION` somente as contas já vinculadas a uma Person gerenciada pela organização; Administradores preservados e perfis manuais inequívocos tornam-se `MANUAL`; casos ambíguos ficam em `REVIEW`. Uma conta Manual nunca é convertida pelo sync. Quando surge uma correspondência organizacional única, a interface apenas sugere **Vínculo organizacional disponível** e exige confirmação explícita; a conversão é auditada. A área comercial nunca pode conceder, editar, desativar ou redefinir a senha de um Administrador da Plataforma. Triggers no PostgreSQL preservam essa proteção mesmo durante uma janela curta de deploy ou rollback para a versão anterior; somente os fluxos internos atuais abrem a autorização transacional explícita.

## Controles de segurança

- login individual com resposta genérica para conta inexistente, inativa ou senha incorreta;
- bcrypt com custo 12, sessão opaca de sete dias e cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- bloqueio temporário após cinco falhas, troca obrigatória da senha temporária e revogação das sessões em reset/desativação;
- autorização central por capacidade e predicados PostgreSQL em listagens, agregados, detalhes por ID e transcript;
- tentativa sem `spend:execute` encerrada antes de job ou provider, com auditoria sanitizada;
- mudança de cargo organizacional não altera a conta Organização IGD: o próximo request recebe imediatamente o novo Acesso Efetivo;
- o sync não altera origem, perfil ou escopo de conta Manual; conversão para Organização IGD é explícita e auditada.

## Administrador inicial e Administração da Plataforma

O bootstrap comercial cria uma única conta administrativa inicial. A senha deve existir apenas em variável temporária:

```bash
read -s BOOTSTRAP_PASSWORD
export BOOTSTRAP_ADMIN_EMAIL='admin@example.invalid'
export BOOTSTRAP_ADMIN_NAME='Administrador'
BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_PASSWORD" npm run auth:bootstrap-admin
unset BOOTSTRAP_PASSWORD BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_NAME
```

Para a concessão técnica inicial, um operador autorizado promove uma conta Administrador ativa que já concluiu a troca de qualquer senha temporária. O comando preserva `user_id`, revoga sessões e audita o evento; ele exige `--apply` e não lê a planilha:

```bash
DATABASE_URL='postgresql://...' PLATFORM_ADMIN_EMAIL='maintainer@example.invalid' \
  npm run auth:bootstrap-platform-admin -- --apply
```

## Operações que podem aumentar gastos

Os caminhos `calls:import -- --apply --request-analysis`, `analysis:process -- --apply` e `POST /api/spend/analyze` exigem `spend:execute`. Nos comandos autorizados, `AUTH_ACTOR_EMAIL` deve apontar para um Administrador da Plataforma ativo. Dry-runs permanecem sem custo e não exigem ator.

## Visualizar como

Somente o Administrador da Plataforma pode iniciar **Visualizar como** para Administrador, Supervisor, Líder, Líder em treinamento, Closer ou SDR. A escolha referencia uma identidade real: Person com cargo vigente para Organização IGD ou conta ativa para Manual. O servidor recalcula o escopo pela mesma view canônica, mantém o ator técnico real na auditoria e bloqueia mutations e gasto até **Sair da visualização**. Se a identidade deixar de ser válida durante a visualização, o contexto permanece sem capacidades e sem dados, identificado como **Identidade indisponível**; a autoridade da Plataforma só volta após a saída explícita.

## Desenvolvimento e validação

O bypass local exige simultaneamente `NODE_ENV=development` e a variável exata abaixo. Produção e teste ignoram a chave; a identidade sintética não possui `spend:execute`.

```bash
DEV_AUTH_BYPASS=true npm run dev
```

O dashboard ainda depende do PostgreSQL. Para testes de integração, use somente host local e um banco cujo nome termine em `_test`:

```bash
TEST_DATABASE_URL='postgresql://127.0.0.1:55439/sales_intelligence_auth_test' npm run test --workspace=@igd/db
npm test
npm run typecheck
npm run build
```

O seed visual é sintético, exige `--apply`, aceita apenas banco local `_test` e nunca registra a senha:

```bash
read -s AUTH_DEMO_PASSWORD
DATABASE_URL='postgresql://127.0.0.1:55439/sales_intelligence_auth_test' \
  AUTH_DEMO_PASSWORD="$AUTH_DEMO_PASSWORD" npm run auth:demo-seed -- --apply
unset AUTH_DEMO_PASSWORD
```

O Basic Auth legado do nginx permanece aposentado; a autenticação individual da aplicação é a camada de acesso dos usuários.
