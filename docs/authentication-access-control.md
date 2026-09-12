# Autenticação e controle de acesso

## Matriz canônica

O PostgreSQL calcula o cargo e a abrangência em cada leitura. A interface pode selecionar apenas um recorte dentro dessa abrangência; parâmetros de URL e campos enviados pelo navegador nunca ampliam acesso.

| Cargo ou autoridade exibida | Origem | Abrangência | Calls e análises | Usuários e vínculos | Configurações comerciais | Operação técnica / IA paga |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Closer | organização oficial | própria Pessoa | Sim | Não | Não | Não |
| SDR | organização oficial | própria Pessoa | Sim | Não | Não | Não |
| Líder | organização oficial | Times liderados | Sim | Não | Não | Não |
| Líder em treinamento | organização oficial | Time atual e Times liderados | Sim | Não | Não | Não |
| Supervisor | organização oficial | Produto atual | Sim | Não | Não | Não |
| Administrador | organização oficial ou conta administrativa preservada | toda a operação comercial | Sim | Sim | Sim | Não |
| Administrador da Plataforma | concessão interna explícita | operação comercial e Plataforma globais | Sim | Sim | Sim | Sim |

Internamente, contas comerciais novas usam a autoridade `ORGANIZATION`; `app_user_effective_scopes` resolve `CLOSER`, `SDR`, `LEADER`, `LEADER_IN_TRAINING`, `SUPERVISOR` ou `ADMIN` pela Person vinculada. `PLATFORM_ADMIN` é uma autoridade separada, não um Cargo Organizacional.

## Gestão de contas

Em **Usuários e acessos**, o Administrador informa nome, e-mail e a Pessoa pelo código V. Não há seletor de perfil, time ou produto: cargo e abrangência acompanham a organização publicada. A tela mostra **Cargo**, **Abrangência** e **Acesso** calculados.

Contas históricas `USER`, `LEADER`, `SUPERVISOR` e `SALES_OPS` continuam reconhecidas para rollback. A migração converte automaticamente as que já possuem vínculo para `ORGANIZATION`; as não vinculadas ficam identificadas para revisão. O servidor rejeita a criação de novos perfis manuais e não permite conceder, editar, desativar ou redefinir a senha de um Administrador da Plataforma pela área comercial.

## Controles de segurança

- login individual com resposta genérica para conta inexistente, inativa ou senha incorreta;
- bcrypt com custo 12, sessão opaca de sete dias e cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- bloqueio temporário após cinco falhas, troca obrigatória da senha temporária e revogação das sessões em reset/desativação;
- autorização central por capacidade e predicados PostgreSQL em listagens, agregados, detalhes por ID e transcript;
- tentativa sem `spend:execute` encerrada antes de job ou provider, com auditoria sanitizada;
- mudança de cargo não altera a conta: o próximo request recebe imediatamente o novo Acesso Efetivo.

## Administrador inicial e Administração da Plataforma

O bootstrap comercial cria uma única conta administrativa inicial. A senha deve existir apenas em variável temporária:

```bash
read -s BOOTSTRAP_PASSWORD
export BOOTSTRAP_ADMIN_EMAIL='admin@example.invalid'
export BOOTSTRAP_ADMIN_NAME='Administrador'
BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_PASSWORD" npm run auth:bootstrap-admin
unset BOOTSTRAP_PASSWORD BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_NAME
```

Para a concessão técnica inicial, um operador autorizado promove uma conta Administrador ativa. O comando preserva `user_id`, revoga sessões e audita o evento; ele exige `--apply` e não lê a planilha:

```bash
DATABASE_URL='postgresql://...' PLATFORM_ADMIN_EMAIL='maintainer@example.invalid' \
  npm run auth:bootstrap-platform-admin -- --apply
```

## Operações que podem aumentar gastos

Os caminhos `calls:import -- --apply --request-analysis`, `analysis:process -- --apply` e `POST /api/spend/analyze` exigem `spend:execute`. Nos comandos autorizados, `AUTH_ACTOR_EMAIL` deve apontar para um Administrador da Plataforma ativo. Dry-runs permanecem sem custo e não exigem ator.

## Visualizar como

Somente o Administrador da Plataforma pode iniciar **Visualizar como** para Administrador, Supervisor, Líder, Líder em treinamento, Closer ou SDR. A escolha contém somente cargo e referência da Person; o servidor recalcula o escopo, mantém o ator técnico real na auditoria e bloqueia mutations e gasto até **Sair da visualização**.

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
