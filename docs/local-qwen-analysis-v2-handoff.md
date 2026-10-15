# Local Qwen Analysis v2 — handoff

Data: 2026-10-15
Branch: feat/qwen9b-analysis-v2

## Estado inicial

O branch continha a arquitetura/documentação base do Sales Intelligence, sem uma implementação local de provider/pipeline nesta linha de desenvolvimento. O System One permanece preservado em seu worktree e nos releases do servidor; não foi alterado.

O material histórico usado como referência está em `/opt/sales-intelligence/releases/c69d955515bbc87cb89c0fe6c71952d3a08f1b1c` no VPS. O baseline histórico usa `call-analysis-v0`, rubric demo v0 e schema legado. A rubrica v1 e o schema v1 foram lidos e usados como direção, não como substituição de análises oficiais.

## Limpeza da VPS

Confirmado antes da limpeza:

- somente `llama-server` ativo usava `Qwen3.5-9B-Q4_K_M.gguf`;
- porta `127.0.0.1:18081` estava ocupada apenas pelo Qwen 9B;
- não havia unidade ativa dos modelos descartados;
- serviços Docker foram apenas observados, não reiniciados nem alterados.

Removidos cirurgicamente:

- `/home/ubuntu/sales-intelligence-local-llm/models/Qwen3.5-4B-Q4_K_M.gguf`;
- `/home/ubuntu/sales-intelligence-local-llm/models/Ministral-3-8B-Instruct-2512-Q4_K_M.gguf`;
- diretórios de benchmark `qwen4b_*` e `ministral8b_*` do run descartável `20261015_034255`;
- caches/unidades específicos encontrados para esses nomes, sem prune global.

Espaço: de 5.7 GB livres / 88% usado para 14 GB livres / 72% usado. O único GGUF restante é `Qwen3.5-9B-Q4_K_M.gguf` (5,780,091,008 bytes). `llama.cpp` compartilhado foi preservado.

## Infraestrutura local

- Modelo: `Qwen3.5-9B-Q4_K_M.gguf`
- Alias: `qwen3.5-9b`
- Runtime: `~/sales-intelligence-local-llm/llama.cpp/build/bin/llama-server`
- Endpoint: `127.0.0.1:18081`
- Acesso: localhost na VPS; não expor diretamente à Internet
- Perfil validado: contexto 32768, 4 threads, CPUQuota aproximada de 380%, reasoning off e sem context shift

## Experimentos

1. Baselines anteriores do run `20261015_034255`: Qwen 9B dia/noite, Qwen 4B e Ministral. Os artefatos exclusivos dos dois modelos descartados foram removidos depois da confirmação de uso.
2. Baseline real direto Qwen 9B iniciado em `qwen9b-baseline-20261015_042612`, usando a call longa e o prompt/rubrica histórica v0. A unidade `si-qwen9b-real-20261015_042612.service` continuou viva após a queda da sessão SSH.
3. Structured output: camada do repositório envia `response_format.type=json_schema` para `/v1/chat/completions`, com contrato fechado e validação local.
4. Multi-pass: fatos/evidências → estado comercial → dimensões → coaching → síntese final.
5. Chunking: divisão por linhas/turnos preservados, com overlap configurável; fatos são extraídos por chunk antes dos passes de síntese.
6. Promptfoo: configuração reproduzível criada em `eval/promptfoo/promptfooconfig.yaml`; o binário não estava instalado no Mac e não foi instalado globalmente.
7. LangExtract: avaliado documentalmente; integração ficou como protótipo/documentação, sem instalar stack paralela.
8. Qdrant, reranker, DSPy e LoRA: deferidos; não há ainda corpus/golden set confiável suficiente para justificar custo e risco nesta sessão.

## Calls usadas

O banco de produção foi lido somente para inventário e comparação histórica:

- longa: `call_id=77d37a58-fcb5-40b1-9568-cd3dcb8e88ed`, `transcript_id=c01203c1-a0eb-4134-95e8-f0ee5f9e6356`, aproximadamente 11.107 palavras e 21.088 tokens formatados;
- curta: `call_id=606acc99-73e6-4dd8-b74d-7f8b13a97cb3`, `transcript_id=569353ed-97fc-4798-9e17-046ff8abbef7`, aproximadamente 1.4 KB.

O benchmark histórico persistido contém 39 linhas, mas somente 2 pares call/transcript distintos, com 13 modelos × 3 resultados/run. Não foram tratados como 39 calls.

## Resultados e métricas

Baseline real Qwen 9B:

- request preparado e tokenizado com sucesso;
- health check retornou `{"status":"ok"}`;
- execução permaneceu ativa após a desconexão SSH;
- durante o acompanhamento, prompt processing foi concluído e a geração avançou em torno de 3.3 tokens/s;
- terminou em 2026-10-15 05:07 UTC, com `finish_reason=stop`;
- input tokens: 21.088; output tokens: 1.863; total: 22.951;
- wall time observado: aproximadamente 41m12s;
- JSON válido e schema válido;
- 7/7 dimensões retornadas (100% de cobertura);
- 3/7 evidências com quote encontrado literalmente na transcrição (42,86% de grounding bruto);
- score retornado: 88; confidence: 0,92; oportunidade `medium`; outcome `follow_up`.

Artefatos preservados em `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/qwen9b-baseline-20261015_042612`.

O avaliador determinístico em `eval/evaluate_local_qwen.py` mede presença de chaves, completude, citações e taxa de grounding sem fazer chamadas externas.

Smoke test real de structured output:

- unidade isolada `si-qwen9b-structured-smoke`;
- `response_format.type=json_schema` no endpoint `/v1/chat/completions`;
- `finish_reason=stop`, 36 input tokens, 49 output tokens;
- JSON parseado e contrato fechado validado;
- unidade parada e porta 18081 liberada ao final.

Smoke test real multi-pass sintético:

- unidade isolada `si-qwen9b-multipass-smoke`;
- 5 passes: fatos, estado comercial, dimensões, coaching e síntese;
- 5/5 respostas structured JSON válidas;
- latências por pass: 70,3s; 29,2s; 83,7s; 98,5s; 115,2s;
- output tokens por pass: 232; 31; 222; 202; 187;
- dados sintéticos, sem banco e sem PII;
- unidade parada e porta 18081 liberada ao final.

## Melhor configuração atual

Configuração preliminar, ainda não declarada vencedora até o término do baseline:

- Qwen3.5 9B Q4_K_M;
- reasoning off;
- temperature 0;
- JSON Schema fechado;
- chunking por turnos com overlap;
- pass factual separado dos passes comercial, dimensional, coaching e síntese;
- evidência validada por substring contra a transcrição antes de persistência;
- endpoint local configurável, sem acoplamento ao processo do llama-server.

## Alterações no código

- `packages/ai_local/ai_local/provider.py`: `LocalQwenProvider`, health check, timeout, endpoint e structured output;
- `packages/ai_local/ai_local/schema.py`: contrato e validação local;
- `packages/ai_local/ai_local/chunking.py`: chunks por linhas/turnos, origem e overlap;
- `packages/ai_local/ai_local/pipeline.py`: pipeline multi-pass e métricas;
- `packages/ai_local/ai_local/config.py`: perfis day/night, endpoint, contexto e timeout;
- `packages/ai_local/tests/test_local_qwen.py`: testes de schema, chunking, pipeline e grounding;
- `eval/evaluate_local_qwen.py`: métricas determinísticas sem APIs pagas;
- `eval/promptfoo/promptfooconfig.yaml`: primeiro caso reproduzível para direct structured analysis.

O provider possui retries limitados para falhas transitórias, rejeita transcrições vazias e a pipeline retorna provenance com hash SHA-256 da transcrição, versão da pipeline e estratégia de chunks.

Todos os testes locais atuais passam:

`PYTHONPATH=packages/ai_local python3 -m unittest discover -s packages/ai_local/tests -v`

## LangExtract

A documentação oficial atual indica suporte a providers OpenAI-compatible com `ModelConfig(provider="openai", provider_kwargs={"base_url": ...})` e também um sistema de custom providers/plugins. Isso torna possível um adapter pequeno para o endpoint local, mas a implementação principal continua sendo o pipeline próprio por ter controle direto sobre chunks, schema e provenance. O plugin comunitário `langextract-llamacpp` foi identificado, porém não foi instalado sem validação de dependências/compatibilidade ARM64.

## Como reproduzir

Na VPS, iniciar o servidor somente em loopback, usando o binário e modelo já instalados, com contexto/threads definidos pelo perfil. Depois executar o provider/pipeline com `endpoint=http://127.0.0.1:18081`.

Testes locais:

```text
PYTHONPATH=packages/ai_local python3 -m unittest discover -s packages/ai_local/tests -v
python3 eval/evaluate_local_qwen.py --transcript <transcript> --result <result.json>
```

Promptfoo, quando instalado em ambiente isolado, deve usar o provider `openai:chat:qwen3.5-9b` com `apiBaseUrl=http://127.0.0.1:18081/v1` para este endpoint. O provider nativo `llama` é reservado ao endpoint legado `/completion` e usa `LLAMA_BASE_URL`, não `config.baseUrl`.

## Próximos passos

1. esperar/verificar o término da unidade do baseline e copiar somente métricas/resultados não sensíveis para o relatório;
2. executar o structured-output contra um prompt pequeno e registrar JSON/schema validity;
3. executar o multi-pass/chunked em pelo menos as duas calls históricas sem gravar PII no Git;
4. adaptar o worker existente para uma interface provider-agnostic e persistir provenance em `analysis_runs`/`analysis_attempts`;
5. usar banco de benchmark isolado para novas execuções locais;
6. só depois avaliar LangExtract, embeddings/Qdrant e reranking com um conjunto de avaliação representativo;
7. publicar no site somente após validação humana e criação de novos `analysis_runs`, nunca sobrescrevendo históricos.

## Estado final conhecido da VPS

No último check:

- 14 GB livres, 72% usado;
- 23 GiB RAM, aproximadamente 14 GiB disponíveis;
- containers existentes observados sem ação;
- Qwen 9B ativo em `127.0.0.1:18081`;
- benchmark real ainda em execução na unidade persistente `si-qwen9b-real-20261015_042612.service`.
