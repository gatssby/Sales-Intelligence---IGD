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

## Transição segura do Basic Auth

Esta entrega não altera nginx nem produção.

1. concluir a autenticação da aplicação e revisar o PR;
2. aplicar a migração em ambiente isolado;
3. criar controladamente o primeiro Admin;
4. validar login, logout, troca de senha, papéis, escopos e bloqueios com dados sintéticos;
5. opcionalmente manter Basic Auth + login da aplicação durante uma janela de transição;
6. remover Basic Auth somente em PR/deploy separado e explicitamente aprovado;
7. confirmar login individual antes de encerrar a janela de rollback.

Rollback: mantenha uma cópia protegida da configuração nginx anterior, preserve o arquivo `htpasswd`, restaure o release imutável anterior se o login falhar e não apague as tabelas de autenticação. Elas são aditivas e não modificam o histórico de calls/análises.

## Validação local

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
