# Architecture

## 1. Objetivo

Construir uma plataforma de Sales Intelligence que consiga receber calls de vendedores da IGD vindas de múltiplas origens, analisar cada call com IA e transformar a análise em dados auditáveis e comparáveis.

O sistema deve suportar múltiplos produtos, múltiplos times e múltiplas versões de rubrica/modelo sem exigir reescrita do pipeline.

---

## 2. Decisão principal

A arquitetura será dividida em cinco camadas:

1. **Sources** — Google Drive, transcrições, gravações e futuramente CRM/Calendly.
2. **Orchestration** — n8n.
3. **Domain/Data** — aplicação + PostgreSQL.
4. **AI Evaluation** — camada provider-agnostic com saída estruturada.
5. **Presentation** — dashboard web.

O n8n não será fonte de verdade e não deverá conter as principais regras de avaliação comercial.

---

## 3. Ingestão do Google Drive

### 3.1 Situação transitória

Enquanto as calls permanecerem nas contas/pastas individuais dos vendedores, teremos uma tabela `source_locations` com, no mínimo:

- `id`
- `seller_id`
- `provider`
- `account_reference`
- `folder_id`
- `active`
- `last_cursor` ou `last_synced_at`
- `metadata`

### 3.2 Estratégia de acesso preferida

Ordem recomendada:

1. **Curto prazo:** vendedores compartilham a pasta raiz relevante com uma conta única de integração.
2. **Escala:** Google Workspace Service Account com Domain-Wide Delegation, caso TI/admin permita.
3. **Estado final:** Shared Drive corporativo para artefatos de calls.

Não manter uma credencial OAuth independente para cada vendedor se pudermos evitar.

### 3.3 Polling

Para robustez, usar **Schedule Trigger + consulta ao Drive** em vez de depender exclusivamente de um trigger por pasta.

O workflow deve:

1. carregar `source_locations` ativas;
2. consultar arquivos novos/alterados desde o último checkpoint;
3. registrar cada arquivo pelo ID do Google Drive;
4. detectar o papel do artefato: gravação, transcrição, notas ou outro;
5. atualizar checkpoint apenas após persistência bem-sucedida.

Se a árvore possuir subpastas, o pipeline deve fazer descoberta explícita/recursiva ou usar o feed de mudanças apropriado. Não assumir que observar uma pasta raiz captura automaticamente alterações em toda a árvore.

---

## 4. Modelo de processamento

### 4.1 Estados

- `DISCOVERED`
- `METADATA_READY`
- `TRANSCRIPT_READY`
- `ANALYSIS_QUEUED`
- `ANALYZING`
- `ANALYZED`
- `BLOCKED`
- `NEEDS_REVIEW`
- `FAILED_RETRYABLE`
- `FAILED_PERMANENT`

### 4.2 Idempotência

Nenhum workflow deve depender apenas de “não vi esse arquivo antes”.

Chaves recomendadas:

- artefato: `provider + external_file_id`
- versão do artefato: `external_file_id + modified_time/checksum`
- análise: `call_id + transcript_version + rubric_version + prompt_version + model_version`

---

## 5. Transcrição

Prioridade:

1. usar transcrição já existente;
2. usar documento/nota exportável para texto;
3. transcrever gravação apenas quando necessário.

A transcrição normalizada deve permitir, quando disponível:

- texto integral;
- timestamps;
- identificação de speaker;
- origem;
- idioma;
- versão.

Gravações não precisam ser copiadas para o banco. O banco deve armazenar metadados e referência ao artefato; cópia para storage próprio só deve ocorrer quando houver necessidade operacional clara.

---

## 6. Análise por IA

### 6.1 Provider abstraction

A aplicação não deve depender diretamente de um modelo específico. Criar interface do tipo:

```ts
interface CallAnalyzer {
  analyze(input: AnalysisInput): Promise<AnalysisOutput>
}
```

Adapters podem existir para OpenAI, Gemini ou outros providers.

### 6.2 Structured output

A IA deve produzir objeto validado por schema. Exemplo conceitual:

```json
{
  "scoreability": "scoreable",
  "unscorable_reason": null,
  "overall_score": 72,
  "opportunity_quality": "qualified",
  "call_status": "lost_by_closer",
  "confidence": 0.88,
  "strengths": [],
  "critical_failures": [],
  "objections": [],
  "coaching_actions": [],
  "dimensions": [],
  "evidence": [],
  "requires_human_review": false
}
```

Campos da planilha do INSIDER devem ser preservados quando forem úteis, mas o novo schema precisa funcionar para outros produtos.

Uma call sem material suficiente usa `scoreability: "unscorable"`, `overall_score: null` e um motivo explícito. Score zero representa performance avaliada, nunca ausência de avaliação.

### 6.3 Lifecycle, confiança e custo

- `analysis_jobs` é o estado operacional durável; `analysis_runs` e `analysis_attempts` preservam o histórico.
- Claims concorrentes usam lease renovado, timeout do provider menor que o lease e `FOR UPDATE SKIP LOCKED`; finalização e recovery são idempotentes.
- `requires_human_review` permanece visível, mas não dispara escalation sozinho.
- A policy `insider-confidence-v2` decide escalation por sinais auditáveis de confiabilidade.
- Antes de cada request, o worker faz uma reserva atômica no ledger PostgreSQL global; settlement usa o custo real de `providerMetadata.gateway.cost`. O mesmo ledger cobre Official Analysis e benchmark.
- A leitura live da key Vercel é uma reconciliação periódica do control plane, não uma dependência do hot path. Falha temporária nessa leitura não autoriza exceder o ledger nem interrompe requests que ainda cabem no teto persistido.
- O teto operacional mantém apenas uma margem técnica pequena. Falta de espaço para a próxima reserva ou resposta 402 do Provider pausa o worker sem marcar a Call como failed.
- O read model administrativo de spend agrega somente PostgreSQL e expõe gasto reconciliado, restante, médias 10/25, estimativa auditável e heartbeat; nenhum read path chama o AI Gateway.
- Requests iniciadas sem receipt ficam em reconciliação e não são repetidas automaticamente.
- O mesmo backlog controla o fetch just-in-time de transcript: claims têm lease, usam janela igual à concorrência e tentativas por arquivo são limitadas. Falha global de autenticação Google interrompe o worker sem transformar todas as Calls em falhas de acesso.

### 6.4 Evidência

Toda crítica relevante deve, quando possível, carregar:

- timestamp;
- speaker;
- trecho curto ou referência;
- afirmação sustentada pela evidência.

O feedback não deve ser somente uma opinião textual genérica.

### 6.5 Rubrica

Estrutura sugerida:

```text
core rubric
  + product rubric
  + qualification rules
  + compliance rules
```

Exemplos de dimensões globais:

- abertura e rapport;
- descoberta;
- qualificação;
- diagnóstico;
- apresentação de valor;
- oferta;
- tratamento de objeções;
- fechamento;
- próximos passos;
- aderência a processo/política.

Produto pode adicionar ou alterar pesos e critérios.

---

## 7. Banco de dados

Entidades principais:

- `users`
- `teams`
- `sellers`
- `products`
- `source_locations`
- `calls`
- `call_artifacts`
- `transcripts`
- `rubrics`
- `rubric_versions`
- `prompt_versions`
- `analysis_runs`
- `analysis_results`
- `analysis_dimensions`
- `analysis_evidence`
- `human_reviews`

### Princípio de histórico

Reanálise nunca sobrescreve a anterior. O dashboard pode apontar para a execução considerada `current`, mas todas as execuções permanecem auditáveis.

---

## 8. Dashboard MVP

### Executivo

- calls descobertas;
- calls analisadas;
- cobertura da IA;
- taxa de venda/conversão quando disponível;
- média de score;
- qualidade das oportunidades;
- principais causas de perda;
- principais falhas dos closers;
- evolução temporal.

### Vendedor

- score médio;
- tendência;
- dimensões mais fortes/fracas;
- padrões recorrentes;
- calls recentes;
- coaching recomendado.

### Call

- metadados;
- transcrição;
- score;
- feedback;
- evidências/timestamps;
- objeções;
- falhas críticas;
- versões de modelo/rubrica/prompt;
- histórico de reanálises/revisões humanas.

### Admin

- vendedores;
- produtos;
- fontes de Drive;
- rubricas;
- modelos;
- status de ingestão;
- erros/bloqueios.

---

## 9. O que reaproveitar da planilha INSIDER

A planilha já mostra conceitos que devem continuar no produto:

- uma linha por call;
- separação entre qualidade da oportunidade e qualidade da condução;
- nota do closer;
- evidência;
- minuto crítico;
- análise de levantada;
- status de arquivo/material;
- tokens/custo/modelo;
- histórico JSON versionado;
- mapeamento de aliases dos vendedores;
- indicadores de cobertura da IA.

Não migrar neste primeiro momento toda a parte de produtividade diária/CRM. O MVP deve permanecer focado em **Sales Call Intelligence**.

---

## 10. Validação da IA

Antes de transformar scores em KPI gerencial, criar uma pequena base “golden set” revisada por humanos.

Sugestão inicial:

- calls de vários closers;
- calls ganhas e perdidas;
- oportunidades boas e ruins;
- produtos diferentes;
- casos claros e casos ambíguos.

Comparar IA vs. avaliação humana por dimensão e revisar prompt/rubrica.

A qualidade do avaliador é um produto do sistema e deve ser medida como tal.

---

## 11. Segurança

Transcrições contêm PII e informações comerciais sensíveis.

Regras mínimas:

- nunca versionar transcrições reais no GitHub;
- nunca versionar tokens/credentials/IDs sensíveis;
- acesso ao dashboard por autenticação;
- autorização por papel;
- logs sem conteúdo integral de calls;
- política de retenção;
- rastrear quem reanalisou/revisou uma call;
- secrets em secret manager/env seguro.

### 11.1 Autenticação e autorização da aplicação

A aplicação usa contas individuais mantidas no PostgreSQL. A autorização é composta por três dimensões separadas:

1. papel (`ADMIN`, `LEADER`, `SUPERVISOR`, `SALES_OPS`);
2. capacidade (`users:manage`, `settings:manage`, `calls:read`, `analytics:read`, `spend:execute`);
3. escopo (`GLOBAL`, conjunto de times ou conjunto de produtos).

A matriz papel → capacidades existe em um único módulo. Páginas, APIs e comandos chamam essa camada em vez de comparar papéis diretamente. Consultas de calls e métricas recebem o contexto de autorização e aplicam o predicado de escopo no PostgreSQL. A mesma regra cobre listagens, detalhes por ID e agregações.

Somente `ADMIN` recebe `spend:execute` nesta versão. Uma tentativa negada termina antes de criar job ou chamar provider e gera um evento de auditoria sem payload da call.

Consulte [ADR 0004](decisions/0004-application-auth-and-access-control.md) e o [runbook de autenticação](authentication-access-control.md).

---

## 12. Próxima implementação

Primeiro vertical slice:

1. criar banco;
2. cadastrar 1 vendedor + 1 pasta Drive + 1 produto;
3. descobrir uma transcrição;
4. persistir a call;
5. analisar com schema estruturado;
6. persistir resultado/evidências;
7. exibir uma página de detalhe da call.

Somente depois expandir para todos os vendedores e dashboards agregados.
