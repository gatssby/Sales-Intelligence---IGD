# Sales Intelligence — IGD

Plataforma de inteligência comercial para analisar calls de vendas da IGD com IA, gerar feedback baseado em evidências e consolidar performance por vendedor, produto e período.

## Estado atual — vertical slice de demonstração

O primeiro fluxo ponta a ponta está implementado:

- PostgreSQL 16 isolado na VPS, acessível somente por túnel SSH;
- schema mínimo de seis entidades com histórico de análises;
- seed privado e idempotente para uma call real (o conteúdo não entra no repositório);
- rubrica `insider-demo-v0`, prompt e saída Zod versionados;
- adapter para Structured Outputs da OpenAI Responses API;
- dashboard Next.js com visão executiva, scorecard do vendedor, detalhe da call, evidências e coaching.

Para abrir a demo localmente, siga [docs/demo-runbook.md](docs/demo-runbook.md). A rubrica v0 é demonstrativa e ainda não deve ser tratada como KPI oficial.

A entrada controlada de calls agora é desacoplada da origem e deduplicada por `transcript_file_id`. O contrato e os comandos seguros estão em [docs/manual-call-ingestion.md](docs/manual-call-ingestion.md); a decisão arquitetural está registrada em [ADR 0002](docs/decisions/0002-source-agnostic-call-ingestion.md).

A descoberta autônoma do Google Drive usa o mesmo OAuth renovável, registra documentos antes de criar calls e reconcilia origens legadas pelo mesmo `transcript_file_id`. O fluxo, os defaults seguros e a operação estão em [docs/drive-discovery.md](docs/drive-discovery.md) e no [ADR 0007](docs/decisions/0007-drive-discovery-and-temporal-attribution.md).

A organização atual é sincronizada de uma Google Sheet oficial por um módulo separado e read-only. Candidates passam por validação fail-closed antes de publicar relações temporais e acesso derivado no PostgreSQL. Consulte [docs/organization-sync.md](docs/organization-sync.md) e o [ADR 0008](docs/decisions/0008-organization-sync-and-derived-access.md).

O procedimento específico para validar o JSONL, importar somente o catálogo e construir a fila fair do primeiro lote INSIDER está em [docs/insider-first-batch-runbook.md](docs/insider-first-batch-runbook.md).

O deploy em `sales-igd.com.br` usa Next.js em container e nginx com HTTPS, mantendo PostgreSQL e a porta do app limitados ao loopback da VPS. O procedimento de atualização e rollback está em [docs/production-runbook.md](docs/production-runbook.md).

A apresentação do produto segue o Figma canônico e os tokens/primitives documentados em [docs/design-system.md](docs/design-system.md). Mudanças visuais devem consultar essa referência antes de introduzir novos padrões.

A autenticação individual da aplicação é a camada principal de acesso. O controle por papel/escopo e a aposentadoria do Basic Auth legado do nginx estão documentados em [docs/authentication-access-control.md](docs/authentication-access-control.md).

## Escopo inicial

O MVP deve:

1. receber calls/transcrições por adaptadores independentes da fonte;
2. normalizar os metadados da call;
3. obter a transcrição existente ou encaminhar a gravação para transcrição;
4. analisar a call com uma rubrica versionada por produto;
5. persistir análise estruturada, evidências, modelo/prompt utilizados e custo;
6. exibir dashboard executivo, visão por vendedor e detalhe da call.

A planilha **Central de Auditoria de Calls — INSIDER** será usada como referência de domínio, não como banco de dados ou motor da aplicação.

## Arquitetura proposta

```text
Google Drive(s)
      │
      ▼
Drive Discovery ── Shared with me / roots / Changes API
      │
      ▼
PostgreSQL ── source of truth
      │
      ├── drive_documents / people / organização temporal
      ├── calls / call_sources / products
      ├── artifacts / transcripts
      ├── analysis_runs / evidence
      └── prompt + rubric versions
      │
      ▼
AI Analysis Layer
      │
      ▼
Web App / Dashboard
```

### Responsabilidades

- **Drive discovery:** daemon idempotente, OAuth renovável, catálogo pré-Call, attribution e reconciliação.
- **PostgreSQL:** fonte única de verdade e controle de idempotência/status.
- **AI layer:** provider-agnostic, saída validada por schema e rubricas versionadas.
- **Web app:** dashboard, filtros, detalhe das calls, coaching e administração.

## Google Drive

### Fontes distribuídas

Cada pasta/origem relevante é cadastrada como `source_location`. O scanner inventaria novas pastas compartilhadas como candidates, percorre apenas roots habilitadas e mantém compatibilidade com os lotes manuais legados.

Preferência imediata: compartilhar as pastas relevantes com uma única conta de integração, em vez de manter uma credencial OAuth diferente por vendedor.

### Estado desejado

Centralizar os artefatos em um **Shared Drive corporativo**. Isso reduz dependência de contas individuais e torna acesso/offboarding mais previsível.

## Pipeline de uma call

```text
DISCOVERED
  → METADATA_READY
  → TRANSCRIPT_READY
  → ANALYSIS_QUEUED
  → ANALYZING
  → ANALYZED

Falhas controladas:
  → BLOCKED
  → NEEDS_REVIEW
  → FAILED_RETRYABLE
```

O processamento deve ser idempotente. Uma análise é identificada, no mínimo, por:

`call + artifact_version + rubric_version + prompt_version + model_version`

Nunca sobrescrever uma análise antiga: reanálise gera um novo `analysis_run`.

## Rubricas

A avaliação será composta por:

- critérios globais de venda;
- critérios específicos do produto;
- regras de qualificação e distribuição;
- política de evidências e confiança.

Os primeiros campos serão derivados do que já funciona na auditoria do INSIDER: qualidade da oportunidade, status da call, nota do closer, falha principal, evidência, minuto crítico, objeção, pontos fortes, falhas críticas e necessidade de revisão.

## Estrutura alvo do repositório

```text
apps/
  web/                 # dashboard e API da aplicação
packages/
  core/                # domínio e regras de negócio
  db/                  # schema/migrations/queries
  ai/                  # providers, prompts, schemas e validação
config/
  products/            # rubricas versionadas por produto
docs/
  architecture.md
  data-model.md
  decisions/           # ADRs
infra/
```

## Princípios

- PostgreSQL é o source of truth; n8n não é dependência do discovery definitivo.
- lógica crítica fica em código versionado.
- prompts/rubricas têm versão explícita.
- toda conclusão relevante da IA deve apontar evidência da call quando possível.
- custos e tokens são rastreados por execução.
- nenhum segredo, transcrição real ou PII deve entrar no GitHub.
- mudanças de agentes devem ocorrer em branches/PRs independentes.

## Próximos marcos

1. receber e validar o primeiro lote privado controlado;
2. obter as transcrições autorizadas e conferir uma amostra manual;
3. executar uma análise por vez pelo AI Gateway;
4. criar uma base humana de referência para validar a qualidade da IA;
5. definir o adaptador futuro para o Drive unificado.
