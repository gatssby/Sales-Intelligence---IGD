# AGENTS.md

Este repositório pode ser modificado por múltiplos agentes de IA. As regras abaixo são obrigatórias para reduzir conflitos e manter decisões auditáveis.

## Agent skills

### Issue tracker

Issues são rastreadas no GitHub em `gatssby/Sales-Intelligence---IGD`. Consulte `docs/agents/issue-tracker.md`.

### Domain docs

O repositório usa um único contexto de domínio em `CONTEXT.md` e preserva ADRs em `docs/decisions/`. Consulte `docs/agents/domain.md`.

## Workflow de Git

- `main` representa o estado estável do projeto.
- Não desenvolver diretamente em `main` após o bootstrap inicial.
- Cada tarefa/agente deve usar uma branch própria.
- Preferir branches curtas, por exemplo:
  - `feat/drive-ingestion`
  - `feat/call-analysis`
  - `feat/dashboard`
  - `fix/analysis-idempotency`
  - `docs/data-model`
- Entregar alterações por Pull Request.
- Não sobrescrever trabalho de outro agente sem revisar o diff/PR correspondente.

## Source of truth

- PostgreSQL é a fonte de verdade dos dados operacionais.
- n8n é orquestrador; não é banco nem local principal de regras de negócio.
- Rubricas, schemas e prompts versionados devem permanecer rastreáveis no repositório e/ou no banco com versão explícita.
- Reanálises geram novas execuções; não apagar histórico anterior.

## Segurança

NUNCA commitar:

- `.env` ou secrets;
- tokens OAuth/API;
- credenciais do n8n;
- transcrições ou gravações reais;
- nomes/e-mails de leads reais em fixtures;
- IDs privados do Google Drive/Sheets;
- exports de produção contendo PII.

Use dados sintéticos em testes e exemplos.

## Arquitetura

Antes de mudanças estruturais, ler:

- `README.md`
- `docs/architecture.md`

Se uma decisão alterar limites entre componentes, modelo de dados, estratégia de ingestão ou versionamento da IA, criar um ADR em `docs/decisions/`.

## Design visual

Antes de introduzir ou alterar padrões visuais no frontend:

1. ler `docs/design-system.md`;
2. inspecionar o Figma canônico com Figma MCP quando o comportamento visual estiver incerto;
3. reutilizar primeiro os tokens, assets e primitives existentes;
4. não criar uma linguagem visual paralela por página.

Referência canônica: [Sales Analytics Dashboard — node `1:7432`](https://www.figma.com/design/FbVg7qSPgfKF6KJgI8KYhK/Sales-Analytics-Dashboard--Community-?node-id=1-7432). O repositório define o comportamento do produto; o Figma define sua apresentação.

## n8n

- Workflows devem ser exportados para `n8n/workflows/`.
- Evitar lógica comercial extensa em Code nodes.
- Workflows devem ser idempotentes e seguros para retry.
- Credenciais permanecem apenas na instância n8n.
- Nomes dos workflows devem deixar clara a responsabilidade.

## IA

- Não espalhar chamadas diretas a providers pela aplicação.
- Usar adapters/provider abstraction.
- Saídas usadas pelo produto devem ser validadas por schema.
- Registrar modelo, versão da rubrica, versão do prompt, timestamps e uso/custo quando disponíveis.
- Feedback relevante deve carregar evidência da call sempre que possível.
- Casos de baixa confiança devem poder ser enviados para revisão humana.

## Qualidade

Para cada PR:

1. manter escopo pequeno e coerente;
2. atualizar testes quando necessário;
3. atualizar documentação quando a arquitetura mudar;
4. executar lint/typecheck/testes disponíveis;
5. descrever no PR o que mudou, por quê e como validar.

## Prioridade atual

Construir primeiro um vertical slice com:

`Drive → ingestão → transcript → análise estruturada → PostgreSQL → detalhe da call`

Não antecipar funcionalidades amplas de CRM/produtividade até esse fluxo estar confiável e validado.
