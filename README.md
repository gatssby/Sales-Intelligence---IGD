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

O deploy em `sales-igd.com.br` usa Next.js em container, nginx com HTTPS e autenticação básica, mantendo PostgreSQL e a porta do app limitados ao loopback da VPS. O procedimento de atualização e rollback está em [docs/production-runbook.md](docs/production-runbook.md).

## Escopo inicial

O MVP deve:

1. descobrir calls/transcrições em múltiplas fontes do Google Drive;
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
    n8n  ── descoberta / ingestão / retries
      │
      ▼
PostgreSQL ── source of truth
      │
      ├── calls / sellers / products
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

- **n8n:** orquestração, polling do Drive, obtenção de arquivos, disparo de jobs e retries.
- **PostgreSQL:** fonte única de verdade e controle de idempotência/status.
- **AI layer:** provider-agnostic, saída validada por schema e rubricas versionadas.
- **Web app:** dashboard, filtros, detalhe das calls, coaching e administração.

## Google Drive

### Fase atual — fontes distribuídas

Cada pasta/origem será cadastrada como uma `source_location` associada a um vendedor. O pipeline percorre todas as fontes ativas e grava o `drive_file_id`, `modified_time` e metadados necessários para evitar processamento duplicado.

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
n8n/
  workflows/           # exports JSON versionados
  docs/
docs/
  architecture.md
  data-model.md
  decisions/           # ADRs
infra/
```

## Princípios

- n8n não é banco nem source of truth.
- lógica crítica fica em código versionado.
- prompts/rubricas têm versão explícita.
- toda conclusão relevante da IA deve apontar evidência da call quando possível.
- custos e tokens são rastreados por execução.
- nenhum segredo, transcrição real ou PII deve entrar no GitHub.
- mudanças de agentes devem ocorrer em branches/PRs independentes.

## Próximos marcos

1. fechar modelo de acesso ao Google Workspace;
2. definir schema inicial do PostgreSQL;
3. transformar a rubrica do INSIDER em schema estruturado;
4. construir workflow n8n de discovery + ingestão;
5. processar um pequeno conjunto de calls ponta a ponta;
6. criar uma base humana de referência para validar a qualidade da IA;
7. construir o primeiro dashboard.
