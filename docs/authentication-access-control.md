# Autenticação e controle de acesso

## Matriz inicial

| Papel | Escopo de leitura | `users:manage` | `settings:manage` | `calls:read` | `analytics:read` | `spend:execute` |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Admin | Global | Sim | Sim | Sim | Sim | Sim |
| Leader | Times associados | Não | Não | Sim | Sim | Não |
| Supervisor | Produtos associados | Não | Não | Sim | Sim | Não |
| Sales Ops | Global | Não | Não | Sim | Sim | Não |

Leader, Supervisor e Sales Ops são somente leitura nesta versão. Novas capacidades sem custo podem ser acrescentadas à matriz central no futuro. `spend:execute` continua restrita a Admin até outra decisão explícita.

## Controles implementados

- login individual com mensagem genérica para conta inexistente, inativa ou senha incorreta;
- bcrypt com custo 12 e política mínima de senha;
- sessão opaca de sete dias, armazenada no servidor e revogável;
- cookies `HttpOnly`, `SameSite=Lax` e `Secure` quando `NODE_ENV=production`;
- bloqueio de 15 minutos após cinco falhas na mesma janela;
- troca obrigatória da senha temporária;
- desativação e reset revogam todas as sessões do usuário;
- escopo obrigatório nas consultas de calls, detalhes e métricas;
- `403` antes de qualquer provider/job quando falta `spend:execute`;
- auditoria de criação, papel, escopo, ativação, desativação, reset e gasto bloqueado.

## Primeiro administrador

Execute as migrações em um ambiente autorizado e forneça a senha somente por variável temporária. O comando recusa criar outro administrador se um Admin já existir.

```bash
read -s BOOTSTRAP_PASSWORD
export BOOTSTRAP_ADMIN_EMAIL='admin@example.invalid'
export BOOTSTRAP_ADMIN_NAME='Administrador'
BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_PASSWORD" npm run auth:bootstrap-admin
unset BOOTSTRAP_PASSWORD BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_NAME
```

O exemplo usa um domínio reservado e não é uma credencial padrão. Substitua o e-mail no ambiente autorizado; não grave a senha em `.env`, histórico, ticket ou PR. O primeiro login exige uma nova senha.

## Demais acessos

1. Entre como Admin e abra **Usuários e acessos**.
2. Informe nome, e-mail e papel.
3. Para Leader, marque um ou mais times. Para Supervisor, marque um ou mais produtos.
4. Revise o resumo de escopo antes de salvar.
5. Copie a senha temporária exibida uma única vez e entregue-a por canal seguro.

Admin e Sales Ops não aceitam escopo específico. Contas não administrativas nunca recebem `spend:execute` nesta versão.

## Comandos que podem aumentar gastos

Os caminhos existentes são:

- `npm run calls:import -- --apply --request-analysis`, que pode enfileirar análise;
- `npm run analysis:process -- --apply`, que chama o provider e conclui a análise;
- `POST /api/spend/analyze`, limite HTTP reservado para futura execução pelo dashboard.

Nos comandos CLI com `--apply`, defina `AUTH_ACTOR_EMAIL` para uma conta Admin ativa. A validação de `spend:execute` ocorre antes de criar job, reivindicar execução ou chamar provider. Dry-runs permanecem sem custo e não exigem ator.

## Basic Auth legado aposentado

Em 2026-09-09, após validação da autenticação individual, das rotas privadas, das APIs, dos papéis, dos escopos e dos bloqueios de gasto, as diretivas de Basic Auth foram removidas do virtual host de `sales-igd.com.br`. A autenticação individual da aplicação passou a ser a única camada de acesso dos usuários.

O arquivo `htpasswd` legado e uma cópia timestampada da configuração nginx anterior permanecem na VPS somente para rollback operacional. Eles não devem ser reutilizados como acesso normal nem ter seu conteúdo copiado para logs, documentação, tickets ou Git.

Rollback: restaure a cópia nginx anterior, valide com `nginx -t` e faça reload gracioso. Não apague nem reverta as tabelas de autenticação da aplicação; elas preservam usuários, sessões, escopos e auditoria.

## Validação local

Para abrir o dashboard local sem criar uma sessão, habilite explicitamente o bypass de desenvolvimento:

```bash
DEV_BYPASS_AUTH=true npm run dev
```

O bypass só é aceito quando `NODE_ENV !== production` e `DEV_BYPASS_AUTH=true`. Ele cria apenas em memória a identidade sintética `Local Development Admin`, sem cookie ou usuário persistente. O contexto mantém o escopo global e as capacidades administrativas necessárias para revisar as áreas comerciais e administrativas, mas remove explicitamente `spend:execute`; assim, a identidade sintética não pode iniciar fluxos pagos. `NODE_ENV=production` ignora a variável mesmo quando ela vale `true`.

O dashboard continua dependendo do PostgreSQL. Configure `apps/web/.env.local` com `DATABASE_URL` apontando para o túnel local ou use `npm run demo`, que valida o banco e abre o túnel quando necessário.

Use apenas uma instância PostgreSQL local cujo banco termine em `_test`. Os testes recusam host remoto. Rode:

```bash
TEST_DATABASE_URL='postgresql://127.0.0.1:55439/sales_intelligence_auth_test' npm run test --workspace=@igd/db
npm test
npm run typecheck
npm run build
```

Para uma demonstração visual, o comando abaixo cria os quatro papéis sintéticos somente nesse banco local. A senha é recebida por variável temporária, não é exibida e não existe no repositório:

```bash
read -s AUTH_DEMO_PASSWORD
DATABASE_URL='postgresql://127.0.0.1:55439/sales_intelligence_auth_test' \
  AUTH_DEMO_PASSWORD="$AUTH_DEMO_PASSWORD" npm run auth:demo-seed -- --apply
unset AUTH_DEMO_PASSWORD
```
