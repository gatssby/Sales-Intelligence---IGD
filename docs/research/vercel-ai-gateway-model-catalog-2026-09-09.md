# Catálogo do Vercel AI Gateway para análise de calls

Consulta realizada em **2026-09-09T19:39:55Z** (2026-09-09 16:39:55 BRT). Pergunta: quais modelos do catálogo atual são técnica e economicamente relevantes para analisar transcrições comerciais longas em português com saída estruturada?

## Fontes e método

- A fotografia integral veio de [`GET https://ai-gateway.vercel.sh/v1/models`](https://ai-gateway.vercel.sh/v1/models). A documentação oficial define esse endpoint como a descoberta dinâmica de modelos disponíveis, preços e capacidades e explica os campos de contexto, saída, tipo e pricing: [Models & Providers](https://vercel.com/docs/ai-gateway/models-and-providers).
- A Vercel documenta `response_format.type = json_schema` como o caminho de structured output na API compatível com OpenAI: [Structured Outputs](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs). O catálogo, porém, só marcou explicitamente `response_format`/`structured_outputs` em um modelo nesta fotografia. Portanto, para os demais modelos de linguagem, a tabela diz **via Gateway; testar**, não “garantido”.
- Preços são os valores-base por token retornados pelo catálogo, convertidos nesta nota para **US$/1M tokens**. A Vercel informa que a cobrança depende do modelo/provider e dos tokens e que o Model List é a fonte mais atual: [AI Gateway Pricing](https://vercel.com/docs/ai-gateway/pricing). Preços com tiers ou variação por endpoint estão sinalizados.
- Não foi feita inferência nesta pesquisa. A enumeração de endpoints dos 16 candidatos abaixo foi read-only; presença no catálogo/endpoints não prova qualidade em português, aderência à rubrica, JSON válido ou estabilidade sob a carga real. Esses quatro itens precisam do benchmark controlado.

## Resultado do levantamento

- **373 modelos** no catálogo.
- **249 text-capable**: tipo `language`, aceita texto e devolve texto.
- **198 tecnicamente elegíveis para algum segmento** após o filtro inicial: 193 para o corpus completo e 5 somente para calls curtas/médias.
- **175 excluídos do benchmark inicial**: modalidades incompatíveis ou modelos explicitamente especializados, contexto menor que 32K ou saída menor que 4K.

### Critério de elegibilidade

A classificação abaixo é deste estudo, não da Vercel. “Corpus completo” exige geração de texto, input textual, preço de input/output disponível, contexto de pelo menos 100K, saída de pelo menos 4K e ausência de especialização evidente em código, busca, segurança, tradução, geração de imagem ou pesquisa multiagente. “Subconjunto” aceita 32K–99.999 tokens para preservar modelos potencialmente úteis em calls menores.

O maior transcript informado tem 212.810 caracteres. Isso não determina sozinho o número de tokens, que varia por tokenizer; portanto 100K é um filtro de pesquisa conservador, e a implementação deve fazer preflight com o tokenizer/limite real do modelo. Modelos menores não são declarados incapazes de toda a workload — apenas inadequados para garantir o corpus inteiro sem chunking, que mudaria o experimento.

### Cobertura por provider/creator

| Provider/creator | Catálogo | Text-capable | Corpus completo | Subconjunto |
|---|---:|---:|---:|---:|
| alibaba | 44 | 31 | 25 | 2 |
| amazon | 5 | 4 | 4 | 0 |
| anthropic | 16 | 16 | 16 | 0 |
| arcee-ai | 1 | 1 | 1 | 0 |
| bfl | 11 | 0 | 0 | 0 |
| bytedance | 13 | 2 | 2 | 0 |
| cohere | 5 | 1 | 1 | 0 |
| deepseek | 11 | 11 | 11 | 0 |
| fish-audio | 8 | 0 | 0 | 0 |
| google | 30 | 19 | 14 | 0 |
| inception | 3 | 3 | 2 | 0 |
| inclusionai | 5 | 5 | 1 | 0 |
| interfaze | 1 | 1 | 0 | 0 |
| klingai | 8 | 0 | 0 | 0 |
| kwaipilot | 4 | 4 | 0 | 0 |
| meta | 12 | 11 | 11 | 0 |
| minimax | 10 | 8 | 8 | 0 |
| mistral | 14 | 12 | 5 | 0 |
| moonshotai | 8 | 8 | 6 | 0 |
| morph | 2 | 2 | 0 | 2 |
| nvidia | 6 | 6 | 6 | 0 |
| openai | 77 | 58 | 48 | 0 |
| perplexity | 5 | 3 | 0 | 0 |
| poolside | 2 | 2 | 0 | 0 |
| prodia | 1 | 0 | 0 | 0 |
| quiverai | 1 | 0 | 0 | 0 |
| recraft | 8 | 0 | 0 | 0 |
| sakana | 2 | 2 | 0 | 0 |
| spacexai | 21 | 12 | 9 | 0 |
| stepfun | 2 | 2 | 2 | 0 |
| tencent | 5 | 5 | 2 | 0 |
| thinkingmachines | 2 | 2 | 2 | 0 |
| voyage | 12 | 0 | 0 | 0 |
| xiaomi | 2 | 2 | 2 | 0 |
| zai | 16 | 16 | 15 | 1 |

Todos os providers retornados foram considerados. Providers com zero candidatos são majoritariamente de embedding, imagem, vídeo, áudio/speech ou reranking; isso é incompatibilidade de modalidade, não julgamento de qualidade do provider.

## Modelos obrigatórios

Os cinco slugs pedidos existem na fotografia, são modelos de linguagem text→text, têm contexto suficiente para o maior transcript informado e entram no benchmark.

| Modelo | Contexto | Max output | Reasoning | Input / 1M | Output / 1M | Cache read / 1M | Structured output | Endpoints enumerados |
|---|---:|---:|---|---:|---:|---:|---|---:|
| `google/gemini-2.5-flash-lite` | 1,048,576 | 65,536 | sim | $0.1 | $0.4 | $0.01 | via Gateway; testar | 2 |
| `openai/gpt-5.6-luna` | 1,050,000 | 128,000 | sim | $0.2 | $1.2 | $0.02 | via Gateway; testar | 3 |
| `minimax/minimax-m3` | 512,000 | 512,000 | sim | $0.3 | $1.2 | $0.06 | via Gateway; testar | 5 |
| `google/gemini-2.5-flash` | 1,000,000 | 65,536 | sim | $0.3 | $2.5 | $0.03 | via Gateway; testar | 2 |
| `openai/gpt-5.6-sol` | 1,050,000 | 128,000 | sim | $2 | $10 | $0.2 | via Gateway; testar | 3 |

## Shortlist de pesquisa para screening

Esta não é uma escolha de PRIMARY/ESCALATION. É uma lista para o screening empírico que cobre os quatro obrigatórios, o `openai/gpt-5.6-sol`, opções baratas de vários providers e referências high-capability. A amostra deve usar prompt, rubrica e schema idênticos.

| Modelo | Provider | Contexto | Max output | Input / 1M | Output / 1M | Cache read / 1M | Reasoning | Endpoints | Custo ilustrativo 60K in + 4K out | Papel sugerido |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| `alibaba/qwen3.8-flash` | alibaba | 991,000 | 128,000 | $0.16 | $0.47 | $0.016 | sim | 1 | $0.0115 | baixo custo/primary |
| `anthropic/claude-sonnet-5` | anthropic | 1,000,000 | 128,000 | $2 | $10 | $0.2 | sim | 4 | $0.1600 | qualidade/escalation |
| `anthropic/claude-opus-4.8` | anthropic | 1,000,000 | 128,000 | $5 | $25 | $0.5 | sim | 4 | $0.4000 | referência high-capability |
| `deepseek/deepseek-v4-flash` | deepseek | 1,000,000 | 384,000 | $0.13 | $0.26 | $0.028 | sim | 10 | $0.0088 | baixo custo/primary |
| `deepseek/deepseek-v4-pro` | deepseek | 1,000,000 | 384,000 | $0.66 | $1.98 | $0.022 | sim | 7 | $0.0475 | candidato geral |
| `google/gemini-2.5-flash-lite` | google | 1,048,576 | 65,536 | $0.1 | $0.4 | $0.01 | sim | 2 | $0.0076 | baixo custo/primary |
| `google/gemini-2.5-flash` | google | 1,000,000 | 65,536 | $0.3 | $2.5 | $0.03 | sim | 2 | $0.0280 | candidato geral |
| `google/gemini-3.8-flash` | google | 1,000,000 | 65,536 | $0.75 | $3.75 | $0.075 | sim | 2 | $0.0600 | candidato geral |
| `minimax/minimax-m3` | minimax | 512,000 | 512,000 | $0.3 | $1.2 | $0.06 | sim | 5 | $0.0228 | candidato geral |
| `mistral/mistral-medium-3.5` | mistral | 256,000 | 256,000 | $1.5 | $7.5 | — | sim | 1 | $0.1200 | candidato geral |
| `moonshotai/kimi-k3` | moonshotai | 1,000,000 | 131,072 | $3 | $15 | $0.3 | sim | 14 | $0.2400 | qualidade/escalation |
| `openai/gpt-5.6-luna` | openai | 1,050,000 | 128,000 | $0.2 | $1.2 | $0.02 | sim | 3 | $0.0168 | candidato geral |
| `openai/gpt-5.6-sol` | openai | 1,050,000 | 128,000 | $2 | $10 | $0.2 | sim | 3 | $0.1600 | qualidade/escalation |
| `openai/gpt-6-astra` | openai | 1,050,000 | 128,000 | $10 | $50 | $1 | sim | 2 | $0.8000 | referência high-capability |
| `spacexai/grok-4.3` | spacexai | 1,000,000 | 1,000,000 | $1.25 | $2.5 | $0.2 | sim | 2 | $0.0850 | candidato geral |
| `zai/glm-5.3-flash` | zai | 1,000,000 | 131,000 | $0.15 | $0.5 | $0.03 | sim | 18 | $0.0110 | baixo custo/primary |

O custo ilustrativo não é previsão do lote: pressupõe exatamente 60K tokens de entrada e 4K de saída, usa preço-base, ignora cache/reasoning tokens, tiers, retries e variação por endpoint. Ele serve apenas para dimensionar o screening antes de consumir crédito.

## Conclusões para o benchmark

1. O catálogo é grande demais para inferência em todos os 198 candidatos. A cobertura completa deve ocorrer no **screening documental**; o screening de inferência deve usar uma amostra estratificada por provider, faixa de preço, contexto e capacidade, incluindo os obrigatórios.
2. Os candidatos baratos mais óbvios para testar como PRIMARY incluem `google/gemini-2.5-flash-lite`, `alibaba/qwen3.8-flash`, `deepseek/deepseek-v4-flash`, `zai/glm-5.3-flash` e `openai/gpt-5.6-luna`. Isso é hipótese econômica, não ranking de qualidade.
3. `openai/gpt-5.6-sol` e `anthropic/claude-sonnet-5` têm o mesmo preço-base nesta fotografia ($2/M input, $10/M output) e são candidatos naturais a referência/escalation. `openai/gpt-6-astra` e `anthropic/claude-opus-4.8` são referências mais caras; devem receber poucas calls se o orçamento for apertado.
4. `minimax/minimax-m3`, `google/gemini-2.5-flash` e alternativas atuais de Grok, GLM, Kimi, Qwen, DeepSeek, Mistral e Claude estão tecnicamente cobertas. A decisão de produção deve ser baseada em schema success, grounding verificável, cobertura da rubrica, coaching, consistência, latência e custo medidos no mesmo corpus.
5. Como o catálogo não declara de forma uniforme suporte a JSON Schema por modelo/endpoint, **schema success é uma métrica eliminatória do benchmark**. A validação Zod continua obrigatória mesmo quando o Gateway aceita `json_schema`.
6. Nenhuma evidência oficial coletada nesta pesquisa mede especificamente português comercial. Portanto, não há base para declarar um vencedor antes do benchmark real em PT-BR.

## Exclusões explícitas

- **124 não-language/incompatíveis:** embedding, image, video, speech, transcription, realtime e reranking não executam a análise textual requerida.
- **46 especializados:** modelos explicitamente voltados a código, busca/web-grounding, safety, tradução, geração de imagem, finanças/saúde, japonês ou pesquisa multiagente foram retirados do primeiro screening de calls. Eles permanecem no catálogo integral abaixo.
- **2 com contexto <32K:** insuficientes até para uma faixa segura de calls longas sem chunking.
- **3 com max output <4K:** risco elevado de truncar o structured output detalhado.
- Contexto abaixo de 100K, isoladamente, não elimina um modelo que ainda possa atender calls curtas/médias; por isso há cinco candidatos “subconjunto”.

## Catálogo integral retornado

Cada linha abaixo deriva do snapshot de `/v1/models` no timestamp desta nota. `Disponível = listado` significa somente presença no catálogo naquele instante; não é SLA nem teste de inferência. Preços são base por 1M tokens e `—` significa ausente/não aplicável no payload.

| Provider | Slug | Tipo/modalidade | Contexto | Max output | JSON/structured | Reasoning | Input / 1M | Output / 1M | Cache read / 1M | Disponibilidade | Fit / limitação |
|---|---|---|---:|---:|---|---|---:|---:|---:|---|---|
| alibaba | `alibaba/qwen-3-14b` | language; text→text | 40,960 | 16,384 | via Gateway; testar | sim | $0.12 | $0.24 | — | listado | subconjunto: somente calls curtas/médias |
| alibaba | `alibaba/qwen-3-235b` | language; text→text | 262,144 | 16,384 | via Gateway; testar | sim | $0.22 | $0.88 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen-3-30b` | language; text→text | 40,960 | 16,384 | via Gateway; testar | sim | $0.12 | $0.5 | — | listado | subconjunto: somente calls curtas/médias |
| alibaba | `alibaba/qwen-3-32b` | language; text→text | 128,000 | 8,192 | via Gateway; testar | sim | $0.16 | $0.64 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen-3.6-max-preview` | language; text→text | 240,000 | 64,000 | via Gateway; testar | sim | $1.3 | $7.8 | $0.26 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3-235b-a22b-thinking` | language; text+image+pdf→text | 131,072 | 32,768 | via Gateway; testar | sim | $0.4 | $4 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3-coder` | language; text→text | 262,144 | 65,536 | via Gateway; testar | não indicado | $1.5 | $7.5 | $0.3 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; tiered, varia por endpoint |
| alibaba | `alibaba/qwen3-coder-30b-a3b` | language; text→text | 262,144 | 8,192 | via Gateway; testar | não indicado | $0.15 | $0.6 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; varia por endpoint |
| alibaba | `alibaba/qwen3-coder-next` | language; text→text | 256,000 | 256,000 | via Gateway; testar | não indicado | $0.5 | $1.2 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| alibaba | `alibaba/qwen3-coder-plus` | language; text→text | 1,000,000 | 65,536 | via Gateway; testar | não indicado | $1 | $5 | $0.2 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; tiered |
| alibaba | `alibaba/qwen3-embedding-0.6b` | embedding; text→text | 32,768 | 32,768 | n/a | não indicado | $0.01 | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/qwen3-embedding-4b` | embedding; text→text | 32,768 | 32,768 | n/a | não indicado | $0.02 | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/qwen3-embedding-8b` | embedding; text→text | 32,768 | 32,768 | n/a | não indicado | $0.05 | — | — | listado | excluído: tipo/modalidade incompatível; varia por endpoint |
| alibaba | `alibaba/qwen3-max` | language; text→text | 262,144 | 32,768 | via Gateway; testar | não indicado | $1.2 | $6 | $0.24 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered, varia por endpoint |
| alibaba | `alibaba/qwen3-max-preview` | language; text→text | 262,144 | 32,768 | via Gateway; testar | não indicado | $1.2 | $6 | $0.24 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3-max-thinking` | language; text→text | 256,000 | 65,536 | via Gateway; testar | sim | $1.2 | $6 | $0.24 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3-next-80b-a3b-instruct` | language; text→text | 131,072 | 32,768 | via Gateway; testar | não indicado | $0.15 | $1.2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3-next-80b-a3b-thinking` | language; text→text | 131,072 | 32,768 | via Gateway; testar | sim | $0.15 | $1.2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3-vl-235b-a22b-instruct` | language; text+image→text | 131,072 | 129,024 | via Gateway; testar | não indicado | $0.4 | $1.6 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3-vl-instruct` | language; text+image→text | 131,072 | 129,024 | via Gateway; testar | não indicado | $0.4 | $1.6 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3-vl-thinking` | language; text+image+pdf→text | 131,072 | 32,768 | via Gateway; testar | sim | $0.4 | $4 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3.5-flash` | language; text+image+pdf→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $0.1 | $0.4 | $0.001 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3.5-plus` | language; text+image+pdf→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $0.4 | $2.4 | $0.04 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3.6-27b` | language; text+image+pdf→text | 256,000 | 256,000 | via Gateway; testar | sim | $0.6 | $3.6 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3.6-plus` | language; text+image+pdf→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $0.5 | $3 | $0.1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3.7-flash` | language; text+image+pdf→text | 991,000 | 64,000 | via Gateway; testar | sim | $0.03 | $0.13 | $0.006 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3.7-max` | language; text→text | 991,000 | 64,000 | via Gateway; testar | sim | $2.5 | $7.5 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3.7-plus` | language; text+image+pdf→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $0.4 | $1.6 | $0.08 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| alibaba | `alibaba/qwen3.8-2.4t-a95b` | language; text+image→text | 262,144 | 128,000 | via Gateway; testar | sim | $2 | $6 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3.8-27b` | language; text+image+pdf+video→text | 1,000,000 | 131,072 | via Gateway; testar | sim | $0.5 | $3 | $0.1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| alibaba | `alibaba/qwen3.8-flash` | language; text+image+pdf→text | 991,000 | 128,000 | via Gateway; testar | sim | $0.16 | $0.47 | $0.016 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3.8-flash-next` | language; text+image→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $0.12 | $0.4 | $0.01 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3.8-max` | language; text+image→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $2 | $6 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/qwen3.8-max-0902` | language; text+image+pdf→text | 991,000 | 128,000 | via Gateway; testar | sim | $2 | $6 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| alibaba | `alibaba/wan-v2.5-t2v-preview` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.6-i2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.6-i2v-flash` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.6-r2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.6-r2v-flash` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.6-t2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.7-r2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v2.7-t2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v3.0-video` | video; text+audio+image+video→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| alibaba | `alibaba/wan-v3.0-video-prime` | video; text+audio+image+video→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| amazon | `amazon/nova-2-lite` | language; text+image+pdf→text | 1,000,000 | 1,000,000 | via Gateway; testar | sim | $0.3 | $2.5 | $0.075 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| amazon | `amazon/nova-lite` | language; text+image+pdf→text | 300,000 | 8,192 | via Gateway; testar | não indicado | $0.06 | $0.24 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| amazon | `amazon/nova-micro` | language; text→text | 128,000 | 8,192 | via Gateway; testar | não indicado | $0.035 | $0.14 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| amazon | `amazon/nova-pro` | language; text+image+pdf→text | 300,000 | 8,192 | via Gateway; testar | não indicado | $0.8 | $3.2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| amazon | `amazon/titan-embed-text-v2` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.02 | — | — | listado | excluído: tipo/modalidade incompatível |
| anthropic | `anthropic/claude-3-haiku` | language; text+image→text | 200,000 | 4,096 | via Gateway; testar | não indicado | $0.25 | $1.25 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-fable-5` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $10 | $50 | $1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-fable-5.1` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $10 | $50 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-haiku-4.5` | language; text+image+pdf→text | 200,000 | 64,000 | via Gateway; testar | sim | $1 | $5 | $0.1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-4` | language; text+image+pdf→text | 200,000 | 8,192 | via Gateway; testar | sim | $15 | $75 | $1.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-4.5` | language; text+image+pdf→text | 200,000 | 64,000 | via Gateway; testar | sim | $5 | $25 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-4.6` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $5 | $25 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-4.7` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $5 | $25 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-4.8` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $5 | $25 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-4.8-fast` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $10 | $50 | $1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-5` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $5 | $25 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-opus-5-fast` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $10 | $50 | $1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-sonnet-4` | language; text+image+pdf→text | 1,000,000 | 8,192 | via Gateway; testar | sim | $3 | $15 | $0.3 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| anthropic | `anthropic/claude-sonnet-4.5` | language; text+image+pdf→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $3 | $15 | $0.3 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| anthropic | `anthropic/claude-sonnet-4.6` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $3 | $15 | $0.3 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| anthropic | `anthropic/claude-sonnet-5` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $2 | $10 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| arcee-ai | `arcee-ai/trinity-large-thinking` | language; text→text | 262,100 | 80,000 | via Gateway; testar | sim | $0.25 | $0.9 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| bfl | `bfl/flux-2-flex` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-2-klein-4b` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-2-klein-9b` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-2-max` | image; text→image | 67,300 | 67,300 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-2-pro` | image; text→image | 67,300 | 67,300 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-3-video` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-kontext-max` | image; text→image | 512 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-kontext-pro` | image; text→image | 512 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-pro-1.0-fill` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-pro-1.1` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bfl | `bfl/flux-pro-1.1-ultra` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seed-1.6` | language; text+image→text | 256,000 | 32,000 | via Gateway; testar | sim | $0.25 | $2 | $0.05 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| bytedance | `bytedance/seed-1.8` | language; text+image→text | 256,000 | 64,000 | via Gateway; testar | sim | $0.25 | $2 | $0.05 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| bytedance | `bytedance/seedance-2.0` | video; text+image→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedance-2.0-fast` | video; text+image→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedance-2.0-mini` | video; text+image→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedance-2.5` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedance-v1.0-pro` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedance-v1.0-pro-fast` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedance-v1.5-pro` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedream-4.0` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedream-4.5` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedream-5.0-lite` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| bytedance | `bytedance/seedream-5.0-pro` | image; text→image | 0 | 0 | n/a | não indicado | $0.003 | — | — | listado | excluído: tipo/modalidade incompatível |
| cohere | `cohere/command-a` | language; text→text | 256,000 | 8,000 | via Gateway; testar | não indicado | $2.5 | $10 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| cohere | `cohere/embed-v4.0` | embedding; text→text | 128,000 | 0 | n/a | não indicado | $0.12 | — | — | listado | excluído: tipo/modalidade incompatível |
| cohere | `cohere/rerank-v3.5` | reranking; text→text | 4,096 | 4,096 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| cohere | `cohere/rerank-v4-fast` | reranking; text→text | 32,000 | 32,000 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| cohere | `cohere/rerank-v4-pro` | reranking; text→text | 32,000 | 32,000 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| deepseek | `deepseek/deepseek-r1` | language; text→text | 128,000 | 8,192 | via Gateway; testar | sim | $1.35 | $5.4 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v3.1` | language; text→text | 163,840 | 128,000 | via Gateway; testar | sim | $0.25 | $0.95 | $0.13 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v3.1-terminus` | language; text→text | 131,072 | 65,536 | via Gateway; testar | sim | $0.27 | $1 | $0.135 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| deepseek | `deepseek/deepseek-v3.2` | language; text→text | 128,000 | 8,000 | via Gateway; testar | não indicado | $0.28 | $0.42 | $0.028 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v3.2-thinking` | language; text→text | 128,000 | 8,000 | via Gateway; testar | não indicado | $0.62 | $1.85 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v4-flash` | language; text→text | 1,000,000 | 384,000 | via Gateway; testar | sim | $0.13 | $0.26 | $0.028 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v4-flash-0731` | language; text→text | 1,000,000 | 384,000 | via Gateway; testar | sim | $0.076 | $0.153 | $0.014 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v4-flash-vision-exp` | language; text+image→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $0.22 | $0.66 | $0.007 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v4-pro` | language; text→text | 1,000,000 | 384,000 | via Gateway; testar | sim | $0.66 | $1.98 | $0.022 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v4-pro-0813` | language; text→text | 1,000,000 | 384,000 | via Gateway; testar | sim | $0.66 | $1.98 | $0.066 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| deepseek | `deepseek/deepseek-v4.1-flash-beta` | language; text+image→text | 1,000,000 | 384,000 | via Gateway; testar | sim | $0.22 | $0.66 | $0.007 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| fish-audio | `fish-audio/s1` | speech; text→audio | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/s1-free` | speech; text→audio | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/s2-pro` | speech; text→audio | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/s2-pro-free` | speech; text→audio | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/s2.1-pro` | speech; text→audio | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/s2.1-pro-free` | speech; text→audio | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/transcribe-1` | transcription; audio→text | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| fish-audio | `fish-audio/transcribe-1-free` | transcription; audio→text | — | — | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/gemini-2.5-flash` | language; text+image+pdf→text | 1,000,000 | 65,536 | via Gateway; testar | sim | $0.3 | $2.5 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-2.5-flash-image` | language; text+image→text+image | 32,768 | 65,536 | via Gateway; testar | não indicado | $0.3 | $2.5 | $0.03 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| google | `google/gemini-2.5-flash-lite` | language; text+image+pdf→text | 1,048,576 | 65,536 | via Gateway; testar | sim | $0.1 | $0.4 | $0.01 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-2.5-pro` | language; text+image+pdf→text | 1,048,576 | 65,536 | via Gateway; testar | sim | $1.25 | $10 | $0.125 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| google | `google/gemini-3-flash` | language; text+image+pdf→text | 1,000,000 | 65,000 | via Gateway; testar | sim | $0.5 | $3 | $0.05 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| google | `google/gemini-3-pro-image` | language; text+image→text+image | 65,536 | 32,768 | via Gateway; testar | não indicado | $2 | $12 | $0.2 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| google | `google/gemini-3.1-flash-image` | language; text+image→text+image | 131,072 | 32,768 | via Gateway; testar | sim | $0.5 | $3 | $0.05 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| google | `google/gemini-3.1-flash-image-preview` | language; text+image→text+image | 131,072 | 32,768 | via Gateway; testar | sim | $0.5 | $3 | $0.05 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| google | `google/gemini-3.1-flash-lite` | language; text+image+pdf→text | 1,000,000 | 65,000 | via Gateway; testar | sim | $0.25 | $1.5 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-3.1-flash-lite-image` | language; text+image→text+image | 65,536 | 4,096 | via Gateway; testar | sim | $0.25 | $1.5 | $0.03 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| google | `google/gemini-3.1-pro-preview` | language; text+image+pdf→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $2 | $12 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| google | `google/gemini-3.5-flash` | language; text+image+pdf+video→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $1.5 | $9 | $0.15 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-3.5-flash-lite` | language; text+image+pdf+video→text | 1,000,000 | 65,000 | via Gateway; testar | sim | $0.3 | $2.5 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-3.5-transcribe` | transcription; audio→text | — | — | n/a | não indicado | $2 | $12 | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/gemini-3.5-transcribe-live` | transcription; audio→text | — | — | n/a | não indicado | $0.0001 | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/gemini-3.6-flash` | language; text+image+pdf+video→text | 1,000,000 | 64,000 | via Gateway; testar | sim | $0.75 | $3.75 | $0.075 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-3.7-flash` | language; text+image+pdf+video→text | 1,000,000 | 65,536 | via Gateway; testar | sim | $0.75 | $3.75 | $0.075 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-3.8-flash` | language; text+image+pdf+video→text | 1,000,000 | 65,536 | via Gateway; testar | sim | $0.75 | $3.75 | $0.075 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemini-embedding-001` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.15 | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/gemini-embedding-2` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.2 | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/gemini-omni-flash-preview` | language; text+image+pdf+video→text+video | 1,000,000 | 57,920 | via Gateway; testar | sim | $1.5 | $9 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| google | `google/gemma-4-26b-a4b-it` | language; text+image+pdf→text | 262,144 | 131,072 | via Gateway; testar | sim | $0.15 | $0.6 | $0.015 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| google | `google/gemma-4-31b-it` | language; text+image+pdf→text | 262,144 | 131,072 | via Gateway; testar | sim | $0.14 | $0.4 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| google | `google/text-embedding-005` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.025 | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/text-multilingual-embedding-002` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.025 | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/veo-3.0-fast-generate-001` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/veo-3.0-generate-001` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/veo-3.1-fast-generate-001` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/veo-3.1-generate-001` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| google | `google/veo-3.1-lite-generate-001` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| inception | `inception/mercury-2` | language; text→text | 128,000 | 128,000 | via Gateway; testar | sim | $0.25 | $0.75 | $0.025 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| inception | `inception/mercury-2.5` | language; text→text | 260,000 | 65,536 | via Gateway; testar | sim | $0.04 | $0.15 | $0.004 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| inception | `inception/mercury-coder-small` | language; text→text | 32,000 | 16,384 | via Gateway; testar | não indicado | $0.25 | $1 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| inclusionai | `inclusionai/ling-3.0-flash` | language; text→text | 256,000 | 32,000 | via Gateway; testar | sim | $0.06 | $0.18 | $0.012 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| inclusionai | `inclusionai/ling-3.0-flash-fin` | language; text→text | 256,000 | 32,000 | via Gateway; testar | sim | $0 | $0 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; varia por endpoint |
| inclusionai | `inclusionai/ling-3.0-flash-fin-free` | language; text→text | 256,000 | 32,000 | via Gateway; testar | sim | $0 | $0 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| inclusionai | `inclusionai/ling-3.0-flash-sante` | language; text→text | 256,000 | 32,000 | via Gateway; testar | sim | $0 | $0 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| inclusionai | `inclusionai/ling-3.0-flash-sante-free` | language; text→text | 256,000 | 32,000 | via Gateway; testar | sim | $0 | $0 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| interfaze | `interfaze/interfaze-beta` | language; text+image+pdf→text | 1,000,000 | 32,000 | via Gateway; testar | sim | $1.5 | $3.5 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| klingai | `klingai/kling-v2.5-turbo-i2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v2.5-turbo-t2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v2.6-i2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v2.6-motion-control` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v2.6-t2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v3.0-i2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v3.0-motion-control` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| klingai | `klingai/kling-v3.0-t2v` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| kwaipilot | `kwaipilot/kat-coder-air-v2.5` | language; text+image→text | 256,000 | 80,000 | via Gateway; testar | sim | $0.15 | $0.6 | $0.03 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| kwaipilot | `kwaipilot/kat-coder-pro-v1` | language; text→text | 256,000 | 32,000 | via Gateway; testar | não indicado | $0.3 | $1.2 | $0.06 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| kwaipilot | `kwaipilot/kat-coder-pro-v2` | language; text→text | 256,000 | 256,000 | via Gateway; testar | sim | $0.3 | $1.2 | $0.06 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| kwaipilot | `kwaipilot/kat-coder-pro-v2.5` | language; text+image→text | 256,000 | 80,000 | via Gateway; testar | sim | $0.74 | $2.96 | $0.15 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| meta | `meta/llama-3.1-70b` | language; text→text | 128,000 | 8,192 | via Gateway; testar | não indicado | $0.72 | $0.72 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| meta | `meta/llama-3.1-8b` | language; text→text | 128,000 | 8,192 | via Gateway; testar | não indicado | $0.22 | $0.22 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| meta | `meta/llama-3.3-70b` | language; text→text | 128,000 | 8,192 | via Gateway; testar | não indicado | $0.72 | $0.72 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| meta | `meta/llama-4-maverick` | language; text+image→text | 128,000 | 8,192 | via Gateway; testar | não indicado | $0.24 | $0.97 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| meta | `meta/llama-4-scout` | language; text+image→text | 128,000 | 8,192 | via Gateway; testar | não indicado | $0.17 | $0.66 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| meta | `meta/muse-glimmer-30b` | language; text+image→text | 131,072 | 131,072 | via Gateway; testar | sim | $0.35 | $1.5 | $0.04 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| meta | `meta/muse-image-1.0` | image; text+image→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| meta | `meta/muse-spark-1.1` | language; text+image+pdf→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $1.25 | $4.25 | $0.15 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| meta | `meta/muse-spark-1.2` | language; text+image+pdf→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $1.25 | $4.25 | $0.15 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| meta | `meta/muse-spark-1.2-contributor` | language; text+image+pdf→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $0.1 | $0.2 | $0.002 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| meta | `meta/muse-spark-1.3` | language; text+image+pdf→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $1.25 | $4.25 | $0.15 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| meta | `meta/muse-spark-1.3-contributor` | language; text+image+pdf→text | 1,048,576 | 1,048,576 | via Gateway; testar | sim | $0.1 | $0.2 | $0.002 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| minimax | `minimax/minimax-h3` | video; text+image→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| minimax | `minimax/minimax-h3-max` | video; text+image→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| minimax | `minimax/minimax-m2` | language; text→text | 205,000 | 205,000 | via Gateway; testar | sim | $0.3 | $1.2 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| minimax | `minimax/minimax-m2.1` | language; text→text | 204,800 | 131,072 | via Gateway; testar | sim | $0.3 | $1.2 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| minimax | `minimax/minimax-m2.1-lightning` | language; text→text | 204,800 | 131,072 | via Gateway; testar | sim | $0.3 | $2.4 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| minimax | `minimax/minimax-m2.5` | language; text→text | 204,800 | 131,000 | via Gateway; testar | sim | $0.3 | $1.2 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| minimax | `minimax/minimax-m2.5-highspeed` | language; text→text | 204,800 | 131,000 | via Gateway; testar | sim | $0.6 | $2.4 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| minimax | `minimax/minimax-m2.7` | language; text→text | 204,800 | 131,000 | via Gateway; testar | sim | $0.3 | $1.2 | $0.06 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| minimax | `minimax/minimax-m2.7-highspeed` | language; text→text | 204,800 | 131,100 | via Gateway; testar | sim | $0.6 | $2.4 | $0.06 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| minimax | `minimax/minimax-m3` | language; text+image+pdf→text | 512,000 | 512,000 | via Gateway; testar | sim | $0.3 | $1.2 | $0.06 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| mistral | `mistral/codestral` | language; text→text | 128,000 | 4,000 | via Gateway; testar | não indicado | $0.3 | $0.9 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| mistral | `mistral/codestral-embed` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.15 | — | — | listado | excluído: tipo/modalidade incompatível |
| mistral | `mistral/devstral-2` | language; text→text | 256,000 | 256,000 | via Gateway; testar | não indicado | $0.4 | $2 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| mistral | `mistral/devstral-small-2` | language; text+image→text | 256,000 | 256,000 | via Gateway; testar | não indicado | $0.1 | $0.3 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| mistral | `mistral/ministral-14b` | language; text+image+pdf→text | 256,000 | 256,000 | via Gateway; testar | não indicado | $0.2 | $0.2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| mistral | `mistral/ministral-3b` | language; text+image→text | 128,000 | 4,000 | via Gateway; testar | não indicado | $0.1 | $0.1 | — | listado | excluído: saída <4K |
| mistral | `mistral/ministral-8b` | language; text+image→text | 128,000 | 4,000 | via Gateway; testar | não indicado | $0.15 | $0.15 | — | listado | excluído: saída <4K |
| mistral | `mistral/mistral-embed` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.1 | — | — | listado | excluído: tipo/modalidade incompatível |
| mistral | `mistral/mistral-large-3` | language; text+image→text | 256,000 | 256,000 | via Gateway; testar | não indicado | $0.5 | $1.5 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| mistral | `mistral/mistral-medium` | language; text+image→text | 128,000 | 64,000 | via Gateway; testar | não indicado | $0.4 | $2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| mistral | `mistral/mistral-medium-3.5` | language; text+image→text | 256,000 | 256,000 | via Gateway; testar | sim | $1.5 | $7.5 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| mistral | `mistral/mistral-nemo` | language; text+image→text | 128,000 | 128,000 | via Gateway; testar | não indicado | $0.15 | $0.15 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| mistral | `mistral/mistral-small` | language; text+image→text | 32,000 | 4,000 | via Gateway; testar | não indicado | $0.1 | $0.3 | — | listado | excluído: contexto <32K |
| mistral | `mistral/pixtral-12b` | language; text+image→text | 128,000 | 4,000 | via Gateway; testar | não indicado | $0.15 | $0.15 | — | listado | excluído: saída <4K |
| moonshotai | `moonshotai/kimi-k2` | language; text→text | 131,072 | 131,072 | via Gateway; testar | não indicado | $0.57 | $2.3 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| moonshotai | `moonshotai/kimi-k2-thinking` | language; text→text | 216,144 | 216,144 | via Gateway; testar | sim | $0.47 | $2 | $0.141 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| moonshotai | `moonshotai/kimi-k2.5` | language; text+image+video→text | 262,114 | 262,114 | via Gateway; testar | sim | $0.6 | $3 | $0.1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| moonshotai | `moonshotai/kimi-k2.6` | language; text+image+video→text | 262,000 | 262,000 | via Gateway; testar | sim | $0.95 | $4 | $0.16 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| moonshotai | `moonshotai/kimi-k2.7-code` | language; text+image+pdf+video→text | 256,000 | 32,768 | via Gateway; testar | sim | $0.95 | $4 | $0.16 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; varia por endpoint |
| moonshotai | `moonshotai/kimi-k2.7-code-highspeed` | language; text+image+pdf+video→text | 262,144 | 32,768 | via Gateway; testar | sim | $1.9 | $8 | $0.38 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| moonshotai | `moonshotai/kimi-k3` | language; text+image+pdf+video→text | 1,000,000 | 131,072 | via Gateway; testar | sim | $3 | $15 | $0.3 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| moonshotai | `moonshotai/kimi-k3-fast` | language; text+image+pdf→text | 1,000,000 | 131,072 | via Gateway; testar | sim | $4.5 | $22.5 | $0.45 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| morph | `morph/morph-v3-fast` | language; text→text | 81,920 | 16,384 | via Gateway; testar | não indicado | $0.8 | $1.2 | — | listado | subconjunto: somente calls curtas/médias |
| morph | `morph/morph-v3-large` | language; text→text | 81,920 | 16,384 | via Gateway; testar | não indicado | $0.9 | $1.9 | — | listado | subconjunto: somente calls curtas/médias |
| nvidia | `nvidia/nemotron-3-nano-30b-a3b` | language; text→text | 262,144 | 262,144 | via Gateway; testar | sim | $0.05 | $0.24 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| nvidia | `nvidia/nemotron-3-super-120b-a12b` | language; text→text | 256,000 | 32,000 | via Gateway; testar | sim | $0.15 | $0.65 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| nvidia | `nvidia/nemotron-3-ultra-550b-a55b` | language; text→text | 1,000,000 | 65,000 | via Gateway; testar | sim | $0.6 | $2.4 | $0.12 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| nvidia | `nvidia/nemotron-3.5-lightning` | language; text→text | 262,144 | 131,072 | via Gateway; testar | sim | $0.05 | $0.2 | $0.01 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| nvidia | `nvidia/nemotron-nano-12b-v2-vl` | language; text+image→text | 131,072 | 131,072 | via Gateway; testar | sim | $0.2 | $0.6 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| nvidia | `nvidia/nemotron-nano-9b-v2` | language; text→text | 131,072 | 131,072 | via Gateway; testar | sim | $0.06 | $0.23 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-3.5-turbo` | language; text→text | 16,385 | 4,096 | via Gateway; testar | não indicado | $0.5 | $1.5 | — | listado | excluído: contexto <32K |
| openai | `openai/gpt-4-turbo` | language; text+image→text | 128,000 | 4,096 | via Gateway; testar | não indicado | $10 | $30 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4.1` | language; text+image+pdf→text | 1,047,576 | 32,768 | via Gateway; testar | não indicado | $2 | $8 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4.1-fast` | language; text+image+pdf→text | 1,047,576 | 32,768 | via Gateway; testar | não indicado | $3.5 | $14 | $0.875 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4.1-mini` | language; text+image+pdf→text | 1,047,576 | 32,768 | via Gateway; testar | não indicado | $0.4 | $1.6 | $0.1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4.1-mini-fast` | language; text+image+pdf→text | 1,047,576 | 32,768 | via Gateway; testar | não indicado | $0.7 | $2.8 | $0.175 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4.1-nano` | language; text+image+pdf→text | 1,047,576 | 32,768 | via Gateway; testar | não indicado | $0.1 | $0.4 | $0.025 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-4.1-nano-fast` | language; text+image+pdf→text | 1,047,576 | 32,768 | via Gateway; testar | não indicado | $0.2 | $0.8 | $0.05 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4o` | language; text+image+pdf→text | 128,000 | 16,384 | via Gateway; testar | não indicado | $2.5 | $10 | $1.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4o-fast` | language; text+image+pdf→text | 128,000 | 16,384 | via Gateway; testar | não indicado | $4.25 | $17 | $2.125 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4o-mini` | language; text+image+pdf→text | 128,000 | 16,384 | via Gateway; testar | não indicado | $0.15 | $0.6 | $0.075 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4o-mini-fast` | language; text+image+pdf→text | 128,000 | 16,384 | via Gateway; testar | não indicado | $0.25 | $1 | $0.125 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-4o-mini-transcribe` | transcription; audio→text | — | — | n/a | não indicado | $1.25 | $5 | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-4o-transcribe` | transcription; audio→text | — | — | n/a | não indicado | $2.5 | $10 | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-5` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.25 | $10 | $0.125 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-5-codex` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.25 | $10 | $0.13 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5-fast` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $2.5 | $20 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5-mini` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $0.25 | $2 | $0.025 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-5-mini-fast` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $0.45 | $3.6 | $0.045 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5-nano` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $0.05 | $0.4 | $0.005 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-5-pro` | language; text+image+pdf→text | 400,000 | 272,000 | via Gateway; testar | sim | $15 | $120 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.1-codex` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.25 | $10 | $0.13 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5.1-codex-max` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.25 | $10 | $0.125 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5.1-codex-mini` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $0.25 | $2 | $0.03 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5.1-thinking` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.25 | $10 | $0.125 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-5.1-thinking-fast` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $2.5 | $20 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.2` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.75 | $14 | $0.175 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-5.2-codex` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.75 | $14 | $0.175 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5.2-fast` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $3.5 | $28 | $0.35 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.2-pro` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $21 | $168 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.3-codex` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.75 | $14 | $0.175 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5.3-codex-fast` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $3.5 | $28 | $0.35 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-5.4` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $2.5 | $15 | $0.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.4-fast` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $5 | $30 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.4-mini` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $0.75 | $4.5 | $0.075 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.4-mini-fast` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $1.5 | $9 | $0.15 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.4-nano` | language; text+image+pdf→text | 400,000 | 128,000 | via Gateway; testar | sim | $0.2 | $1.25 | $0.02 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.4-pro` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $30 | $180 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.5` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $5 | $30 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered, varia por endpoint |
| openai | `openai/gpt-5.5-fast` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $12.5 | $75 | $1.25 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/gpt-5.5-pro` | language; text+image+pdf→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $30 | $180 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.6-luna` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $0.2 | $1.2 | $0.02 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.6-luna-fast` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $0.4 | $2.4 | $0.04 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.6-sol` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $2 | $10 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered, varia por endpoint |
| openai | `openai/gpt-5.6-sol-fast` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $4 | $20 | $0.4 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.6-terra` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $2 | $12 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-5.6-terra-fast` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $4 | $24 | $0.4 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-6-astra` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $10 | $50 | $1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-6-astra-fast` | language; text+image+pdf→text | 1,050,000 | 128,000 | via Gateway; testar | sim | $20 | $100 | $2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| openai | `openai/gpt-image-1` | image; text→image | 0 | 0 | n/a | não indicado | $5 | $40 | $1.25 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-image-1-mini` | image; text→image | 0 | 0 | n/a | não indicado | $2 | $8 | $0.2 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-image-1.5` | image; text→image | 0 | 0 | n/a | não indicado | $5 | $32 | $1.25 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-image-2` | image; text→image | 0 | 0 | n/a | não indicado | $5 | $30 | $1.25 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-image-2.5-flare` | image; text→image | 0 | 0 | n/a | não indicado | $5 | $30 | $1.25 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-image-2.5-sunburst` | image; text→image | 0 | 0 | n/a | não indicado | $5 | $30 | $1.25 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-oss-120b` | language; text→text | 131,072 | 131,072 | via Gateway; testar | sim | $0.1 | $0.5 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-oss-20b` | language; text→text | 131,072 | 8,192 | via Gateway; testar | sim | $0.05 | $0.2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| openai | `openai/gpt-oss-safeguard-120b` | language; text→text | 128,000 | 16,000 | via Gateway; testar | sim | $0.15 | $0.6 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| openai | `openai/gpt-oss-safeguard-20b` | language; text→text | 128,000 | 16,000 | via Gateway; testar | sim | $0.07 | $0.2 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; varia por endpoint |
| openai | `openai/gpt-realtime-1.5` | realtime; text+audio→text+audio | 0 | 0 | n/a | não indicado | $4 | $16 | $0.4 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-realtime-2` | realtime; text+audio→text+audio | 0 | 0 | n/a | não indicado | $4 | $24 | $0.4 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-realtime-2.1` | realtime; text+audio→text+audio | 128,000 | 32,000 | n/a | sim | $4 | $24 | $0.4 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-realtime-mini` | realtime; text+audio→text+audio | 0 | 0 | n/a | não indicado | $0.6 | $2.4 | $0.06 | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/gpt-realtime-whisper` | transcription; audio→text | — | — | n/a | não indicado | $0.0002 | — | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/o1` | language; text+image+pdf→text | 200,000 | 100,000 | via Gateway; testar | sim | $15 | $60 | $7.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/o3` | language; text+image+pdf→text | 200,000 | 100,000 | via Gateway; testar | sim | $2 | $8 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/o3-fast` | language; text+image+pdf→text | 200,000 | 100,000 | via Gateway; testar | sim | $3.5 | $14 | $0.875 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/o3-mini` | language; text→text | 200,000 | 100,000 | via Gateway; testar | sim | $1.1 | $4.4 | $0.55 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/o3-pro` | language; text+image+pdf→text | 200,000 | 100,000 | via Gateway; testar | sim | $20 | $80 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/o4-mini` | language; text+image+pdf→text | 200,000 | 100,000 | via Gateway; testar | sim | $1.1 | $4.4 | $0.275 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/o4-mini-fast` | language; text+image+pdf→text | 200,000 | 100,000 | via Gateway; testar | sim | $2 | $8 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| openai | `openai/text-embedding-3-large` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.13 | — | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/text-embedding-3-small` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.02 | — | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/text-embedding-ada-002` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.1 | — | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/tts-1` | speech; text→audio | — | — | n/a | não indicado | $15 | — | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/tts-1-hd` | speech; text→audio | — | — | n/a | não indicado | $30 | — | — | listado | excluído: tipo/modalidade incompatível |
| openai | `openai/whisper-1` | transcription; audio→text | — | — | n/a | não indicado | $0.0001 | — | — | listado | excluído: tipo/modalidade incompatível |
| perplexity | `perplexity/pplx-embed-v1-0.6b` | embedding; text→text | 32,000 | 0 | n/a | não indicado | $0.004 | — | — | listado | excluído: tipo/modalidade incompatível |
| perplexity | `perplexity/pplx-embed-v1-4b` | embedding; text→text | 32,000 | 0 | n/a | não indicado | $0.03 | — | — | listado | excluído: tipo/modalidade incompatível |
| perplexity | `perplexity/sonar` | language; text+image→text | 127,000 | 8,000 | via Gateway; testar | não indicado | — | — | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| perplexity | `perplexity/sonar-pro` | language; text+image→text | 200,000 | 8,000 | via Gateway; testar | não indicado | — | — | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| perplexity | `perplexity/sonar-reasoning-pro` | language; text+image→text | 127,000 | 8,000 | via Gateway; testar | sim | — | — | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| poolside | `poolside/laguna-s-2.1` | language; text→text | 1,000,000 | 131,072 | via Gateway; testar | sim | $0.1 | $0.2 | $0.01 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| poolside | `poolside/laguna-s-2.1-free` | language; text→text | 256,000 | 32,768 | via Gateway; testar | sim | $0 | $0 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| prodia | `prodia/flux-fast-schnell` | image; text→image | 512 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| quiverai | `quiverai/arrow-1.1` | image; text→image | 131,072 | 131,072 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v2` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v3` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v4` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v4-pro` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v4.1` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v4.1-pro` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v4.1-utility` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| recraft | `recraft/recraft-v4.1-utility-pro` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| sakana | `sakana/fugu-ultra` | language; text+image→text | 1,000,000 | 1,000,000 | via Gateway; testar | sim | $5 | $30 | $0.5 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; tiered |
| sakana | `sakana/namazu` | language; text+image+pdf→text | 256,000 | 256,000 | explícito no catálogo | sim | $0.95 | $4 | $0.15 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| spacexai | `spacexai/grok-4.1-fast-non-reasoning` | language; text+image+pdf→text | 1,000,000 | 1,000,000 | via Gateway; testar | não indicado | $0.2 | $0.5 | $0.05 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| spacexai | `spacexai/grok-4.1-fast-reasoning` | language; text+image+pdf→text | 1,000,000 | 1,000,000 | via Gateway; testar | sim | $0.2 | $0.5 | $0.05 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| spacexai | `spacexai/grok-4.20-multi-agent` | language; text+image+pdf→text | 2,000,000 | 2,000,000 | via Gateway; testar | sim | $1.25 | $2.5 | $0.2 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; tiered |
| spacexai | `spacexai/grok-4.20-multi-agent-beta` | language; text+image+pdf→text | 2,000,000 | 2,000,000 | via Gateway; testar | sim | $1.25 | $2.5 | $0.2 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; tiered |
| spacexai | `spacexai/grok-4.20-non-reasoning` | language; text+image+pdf→text | 2,000,000 | 2,000,000 | via Gateway; testar | não indicado | $1.25 | $2.5 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered, varia por endpoint |
| spacexai | `spacexai/grok-4.20-non-reasoning-beta` | language; text+image+pdf→text | 2,000,000 | 2,000,000 | via Gateway; testar | não indicado | $1.25 | $2.5 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| spacexai | `spacexai/grok-4.20-reasoning` | language; text+image+pdf→text | 2,000,000 | 2,000,000 | via Gateway; testar | sim | $1.25 | $2.5 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered, varia por endpoint |
| spacexai | `spacexai/grok-4.20-reasoning-beta` | language; text+image+pdf→text | 2,000,000 | 2,000,000 | via Gateway; testar | sim | $1.25 | $2.5 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| spacexai | `spacexai/grok-4.3` | language; text+image+pdf→text | 1,000,000 | 1,000,000 | via Gateway; testar | sim | $1.25 | $2.5 | $0.2 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| spacexai | `spacexai/grok-4.5` | language; text+image+pdf→text | 500,000 | 500,000 | via Gateway; testar | sim | $2 | $6 | $0.3 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| spacexai | `spacexai/grok-4.6` | language; text+image→text | 500,000 | 500,000 | via Gateway; testar | sim | $2 | $6 | $0.5 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; tiered |
| spacexai | `spacexai/grok-build-0.1` | language; text+image→text | 256,000 | 256,000 | via Gateway; testar | sim | $1 | $2 | $0.2 | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente; tiered |
| spacexai | `spacexai/grok-imagine-image` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-imagine-image-2.0` | image; text→image | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-imagine-video` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-imagine-video-1.5` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-imagine-video-1.5-preview` | video; text→video | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-stt` | transcription; audio→text | — | — | n/a | não indicado | $0 | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-tts` | speech; text→audio | — | — | n/a | não indicado | $15 | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-voice-think-fast-1.0` | realtime; text+audio→text+audio | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| spacexai | `spacexai/grok-voice-think-fast-2.0` | realtime; text+audio→text+audio | 0 | 0 | n/a | não indicado | — | — | — | listado | excluído: tipo/modalidade incompatível |
| stepfun | `stepfun/step-3.5-flash` | language; text+image→text | 262,114 | 262,114 | via Gateway; testar | sim | $0.09 | $0.3 | $0.02 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| stepfun | `stepfun/step-3.7-flash` | language; text+image→text | 256,000 | 256,000 | via Gateway; testar | sim | $0.2 | $1.15 | $0.04 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| tencent | `tencent/hy-mt2-lite` | language; text→text | 8,000 | 4,000 | via Gateway; testar | não indicado | $0.044 | $0.177 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| tencent | `tencent/hy-mt2-plus` | language; text→text | 8,000 | 4,000 | via Gateway; testar | não indicado | $0.074 | $0.295 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| tencent | `tencent/hy-mt2-pro` | language; text→text | 8,000 | 4,000 | via Gateway; testar | não indicado | $0.074 | $0.295 | — | listado | excluído: especialista em código, busca, segurança, tradução, imagem ou pesquisa multiagente |
| tencent | `tencent/hy3` | language; text→text | 262,144 | 262,144 | via Gateway; testar | sim | $0.14 | $0.58 | $0.035 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| tencent | `tencent/hy4-preview` | language; text→text | 1,024,000 | 64,000 | via Gateway; testar | sim | $0.834 | $2.501 | $0.042 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| thinkingmachines | `thinkingmachines/inkling` | language; text+image+pdf→text | 256,000 | 256,000 | via Gateway; testar | sim | $1 | $4.05 | $0.17 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| thinkingmachines | `thinkingmachines/inkling-small` | language; text+image+pdf→text | 1,000,000 | 1,000,000 | via Gateway; testar | sim | $0.5 | $1.2 | $0.1 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| voyage | `voyage/rerank-2.5` | reranking; text→text | 32,000 | 32,000 | n/a | não indicado | $0.05 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/rerank-2.5-lite` | reranking; text→text | 32,000 | 32,000 | n/a | não indicado | $0.02 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-3-large` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.18 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-3.5` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.06 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-3.5-lite` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.02 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-4` | embedding; text→text | 32,000 | 0 | n/a | não indicado | $0.06 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-4-large` | embedding; text→text | 32,000 | 0 | n/a | não indicado | $0.12 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-4-lite` | embedding; text→text | 32,000 | 0 | n/a | não indicado | $0.02 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-code-2` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.12 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-code-3` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.18 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-finance-2` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.12 | — | — | listado | excluído: tipo/modalidade incompatível |
| voyage | `voyage/voyage-law-2` | embedding; text→text | 0 | 0 | n/a | não indicado | $0.12 | — | — | listado | excluído: tipo/modalidade incompatível |
| xiaomi | `xiaomi/mimo-v2.5` | language; text+image→text | 1,050,000 | 131,100 | via Gateway; testar | sim | $0.14 | $0.28 | $0.0028 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| xiaomi | `xiaomi/mimo-v2.5-pro` | language; text→text | 1,050,000 | 131,000 | via Gateway; testar | sim | $0.435 | $0.87 | $0.0036 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-4.5` | language; text→text | 128,000 | 96,000 | via Gateway; testar | sim | $0.6 | $2.2 | $0.11 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-4.5-air` | language; text→text | 128,000 | 96,000 | via Gateway; testar | sim | $0.2 | $1.1 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-4.5v` | language; text+image→text | 66,000 | 16,000 | via Gateway; testar | sim | $0.6 | $1.8 | $0.11 | listado | subconjunto: somente calls curtas/médias |
| zai | `zai/glm-4.6` | language; text→text | 200,000 | 96,000 | via Gateway; testar | sim | $0.6 | $2.2 | $0.11 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-4.7` | language; text→text | 200,000 | 120,000 | via Gateway; testar | sim | $0.6 | $2.2 | $0.12 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-4.7-flash` | language; text→text | 200,000 | 131,000 | via Gateway; testar | sim | $0.07 | $0.4 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-4.7-flashx` | language; text→text | 200,000 | 128,000 | via Gateway; testar | sim | $0.06 | $0.4 | $0.01 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-5` | language; text→text | 202,800 | 131,100 | via Gateway; testar | sim | $1 | $3.2 | — | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-5-turbo` | language; text→text | 202,800 | 131,100 | via Gateway; testar | sim | $1.2 | $4 | $0.24 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-5.1` | language; text→text | 202,800 | 64,000 | via Gateway; testar | sim | $1.4 | $4.4 | $0.26 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-5.2` | language; text→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $0.8 | $2.55 | $0.16 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-5.2-fast` | language; text→text | 1,000,000 | 128,000 | via Gateway; testar | sim | $2.1 | $6.6 | $0.21 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-5.3` | language; text→text | 1,000,000 | 1,000,000 | via Gateway; testar | sim | $1.4 | $4.4 | $0.14 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-5.3-fast` | language; text→text | 1,048,576 | 262,144 | via Gateway; testar | sim | $2.1 | $6.6 | $0.21 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |
| zai | `zai/glm-5.3-flash` | language; text+image→text | 1,000,000 | 131,000 | via Gateway; testar | sim | $0.15 | $0.5 | $0.03 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark; varia por endpoint |
| zai | `zai/glm-5v-turbo` | language; text+image+pdf→text | 200,000 | 128,000 | via Gateway; testar | sim | $1.2 | $4 | $0.24 | listado | corpus completo: candidato técnico; qualidade/PT-BR/JSON ainda exigem benchmark |

## Limitações desta fotografia

- O catálogo é mutável; slugs, preços, endpoints e capacidades podem mudar depois do timestamp. Reconsultar `/v1/models` imediatamente antes de congelar a configuração de produção.
- `owned_by` identifica o creator/owner do slug; o Gateway pode roteá-lo por múltiplos providers de inferência com preço e desempenho distintos.
- O catálogo não oferece uma declaração uniforme de idiomas nem garantia uniforme de JSON Schema. Português, qualidade e schema precisam de medição real.
- Context window é limite combinado dependente da API/modelo. O preflight deve reservar espaço para prompt, schema, reasoning e output.
- Preços-base não incluem necessariamente recursos opcionais, tiers, variações regionais/fast, web search ou retries.

