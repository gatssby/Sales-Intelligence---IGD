# ADR 0002 — histórico versionado no pipeline Qwen

Data: 2026-10-15
Status: accepted

## Decisão

Usar `call-analysis-v1` com `insider-production-v1` como base histórica ativa do pipeline local Qwen. Manter v0 apenas como referência de comportamento legado.

## Comparação

| Material | Status | Diferença relevante | Decisão |
|---|---|---|---|
| `call-analysis-v0.md` | demo/legado | Regras básicas de grounding e schema, sem regra explícita de scoreability | Não usar como prompt principal |
| `call-analysis-v1.md` | versão mais recente | Define `unscorable`, score nulo quando não avaliável, revisão humana e proíbe score zero como ausência de dados | Usar |
| `rubric.v0.json` | `demo_unvalidated` | Mesmas dimensões/pesos atuais, mas não homologada como KPI | Referência somente |
| `rubric.v1.json` | `active` | `insider-production-v1`, mesma estrutura dimensional, explicitamente ativa | Usar |

A v1 não é tratada como verdade gerencial definitiva; ela é a melhor base versionada disponível e continua sujeita a validação de negócio.

## Aplicação por estratégia

- `direct`: recebe o prompt v1, a rubrica v1 resumida com dimensões/pesos/significados, regras de grounding e JSON Schema final.
- `two_pass`: recebe regras de grounding na extração factual e prompt v1/rubrica necessária apenas na síntese final.
- `multipass`: fatos usam grounding; comercial usa critérios de qualificação/diagnóstico/fechamento; dimensões usam a rubrica; coaching usa regras de coaching; síntese recebe consistência final e contrato.

A rubrica completa não é retransmitida desnecessariamente em todos os passes.

## Provenance obrigatória

Cada resultado deve registrar:

- `prompt_version`;
- `rubric_version`;
- `schema_version`;
- `pipeline_version`;
- estratégia;
- hash da transcrição;
- estratégia de chunks.

## Limite

Esta decisão não promove o resultado para análise oficial, não altera o worker/site e não transforma a rubrica v1 em KPI definitivo sem revisão humana.
