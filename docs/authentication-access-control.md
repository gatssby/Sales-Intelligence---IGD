# Autenticação e controle de acesso

## Matriz de perfis de acesso

| Perfil exibido | Identificador interno | Abrangência de leitura | `users:manage` | `settings:manage` | `calls:read` | `analytics:read` | `spend:execute` |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Administrador | `ADMIN` | Global | Sim | Sim | Sim | Sim | Sim |
| Pessoa | `USER` | Pessoa vinculada e responsabilidades organizacionais atuais | Não | Não | Sim | Sim | Não |
| Líder | `LEADER` | Pessoa vinculada e responsabilidades organizacionais atuais | Não | Não | Sim | Sim | Não |
| Supervisor | `SUPERVISOR` | Pessoa vinculada e responsabilidades organizacionais atuais | Não | Não | Sim | Sim | Não |
| Operações comerciais | `SALES_OPS` | Global | Não | Não | Sim | Sim | Não |

Pessoa, Líder, Supervisor e Operações comerciais são somente leitura nesta versão. Para contas vinculadas, produtos, frentes, times, liderança, supervisão e dados próprios são derivados da organização publicada; a tela não pede permissões manuais redundantes. Os escopos manuais antigos permanecem apenas como fallback para contas ainda não vinculadas. `spend:execute` continua restrita ao Administrador até outra decisão explícita.

O perfil **Administrador da Plataforma** é técnico e protegido. Sua concessão não faz parte da área comercial de Usuários e acessos, por isso ele não aparece como opção de criação ou edição nessa tela.

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

1. Entre como Administrador e abra **Usuários e acessos**.
2. Informe nome, e-mail e perfil de acesso.
3. Vincule a conta à Pessoa correta pelo código V quando o perfil usar acesso derivado da organização.
4. Salve e confira a abrangência recalculada pela organização.
5. Copie a senha temporária exibida uma única vez e entregue-a por canal seguro.

Administrador e Operações comerciais usam abrangência global e não aceitam permissões específicas. Contas não administrativas nunca recebem `spend:execute` nesta versão.

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
