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
4. Multi-pass: fatos/evidências → estado comercial → dimensões → coaching → síntese final; cada etapa recebe schema intermediário e limites de saída menores.
5. Chunking: divisão por linhas/turnos preservados, com overlap configurável; fatos são extraídos por chunk antes dos passes de síntese.
6. O CLI permite `--strategy direct|multipass`; `direct` é o default operacional rápido e `multipass` é o modo de qualidade/night.
7. Promptfoo: configuração reproduzível criada em `eval/promptfoo/promptfooconfig.yaml`; o binário não estava instalado no Mac e não foi instalado globalmente.
8. LangExtract: avaliado documentalmente; integração ficou como protótipo/documentação, sem instalar stack paralela.
9. Qdrant, reranker, DSPy e LoRA: deferidos; não há ainda corpus/golden set confiável suficiente para justificar custo e risco nesta sessão.
10. Prompt/rubric históricos agora estão versionados em `packages/ai_local/ai_local/resources/`. A decisão atual é `call-analysis-v1` + `insider-production-v1`: a v1 está ativa e a v0 está marcada `demo_unvalidated`.

## Calls usadas

O banco de produção foi lido somente para inventário e comparação histórica:

- longa: `call_id=77d37a58-fcb5-40b1-9568-cd3dcb8e88ed`, `transcript_id=c01203c1-a0eb-4134-95e8-f0ee5f9e6356`, aproximadamente 11.107 palavras e 21.088 tokens formatados;
- curta: `call_id=606acc99-73e6-4dd8-b74d-7f8b13a97cb3`, `transcript_id=569353ed-97fc-4798-9e17-046ff8abbef7`, aproximadamente 1.4 KB.

O benchmark histórico persistido contém 39 linhas, mas somente 2 pares call/transcript distintos, com 13 modelos × 3 resultados/run. Não foram tratados como 39 calls.

Uma inspeção adicional de `analysis_runs` encontrou 180 pares call/transcript distintos, 178 execuções `completed` e 2 `queued`. A distribuição por tamanho do texto normalizado foi: 16 curtas, 58 médias, 89 longas e 17 muito longas. Esses 180 pares são o corpus candidato para a próxima seleção estratificada; nenhum texto real foi copiado para o Git.

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

Comparação A/B real, mesma entrada sintética, run `qwen9b-direct-vs-schema-20261015_053805`:

- direct sem `response_format`: JSON válido, mas schema inválido; 66 tokens de saída e 22,9s;
- JSON Schema via `response_format`: JSON válido e schema válido; 39 tokens de saída e 11,0s;
- ambas terminaram com `finish_reason=stop`;
- artefatos: `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/qwen9b-direct-vs-schema-20261015_053805/`;
- conclusão: structured output é necessário para contrato seguro; validação posterior sozinha não basta.

Smoke test real multi-pass sintético:

- unidade isolada `si-qwen9b-multipass-smoke`;
- 5 passes: fatos, estado comercial, dimensões, coaching e síntese;
- 5/5 respostas structured JSON válidas;
- latências por pass: 70,3s; 29,2s; 83,7s; 98,5s; 115,2s;
- output tokens por pass: 232; 31; 222; 202; 187;
- dados sintéticos, sem banco e sem PII;
- unidade parada e porta 18081 liberada ao final.

Execução real do pacote atual via CLI/job resumível, com runtime night e transcript sintético:

- job: `si-qwen9b-job-synthetic-call-20261015.service`;
- resultado: `/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/artifacts/synthetic-call-20261015.json`;
- status: `Result=success`, `ExecMainStatus=0`, unidade concluída;
- 5 passes, 1 chunk, schema válido, 3 evidências grounded, grounding rate 1.0;
- retries: 1; latência total: 854.227 segundos (aprox. 14m14s), devido ao custo de geração estruturada no ARM;
- runtime parado depois da verificação; porta 18081 livre.

O caminho direto foi adicionado para evitar que o default de amanhã force cinco gerações em toda call. O modo multi-pass permanece disponível explicitamente e deve ser usado em amostras selecionadas/revisão de qualidade até haver uma medição real melhor.

O pipeline histórico novo usa `local-qwen-v3-historical` e grava em provenance: `prompt_version`, `rubric_version`, `schema_version`, `pipeline_version`, estratégia, hash da transcrição e estratégia de chunks. Foram adicionadas as estratégias `two_pass` (extração factual → análise final) e `multipass` com prompts específicos por etapa, sem reenviar a rubrica inteira a todos os passes.

O benchmark direct/night de três tamanhos foi preparado na VPS em `/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/qwen-v3-direct-20261015/`, usando calls concluídas do corpus: curta `22376805-e12c-4c84-a48d-f3bb2d291882`, média `87ac9b12-7e14-4fde-91c5-b5ccd253abd7` e longa `0bc1fbae-104b-4e26-a0b7-fbafe157e93b`. A curta concluiu com o prompt novo, schema válido, 7/7 dimensões, 1 evidência não grounded e scoreability `unscorable`; a primeira tentativa falhou porque a cópia da VPS ainda estava no código genérico e foi descartada.

A média concluiu com schema válido, 7/7 dimensões, 3 evidências, grounding 1/3, 1 retry, 1.712 tokens de entrada, 1.381 de saída, 4.328 prompt tok/s, 5,52 generation tok/s e 551.695 ms. A longa concluiu após ampliar o timeout night e corrigir sua propagação para a unidade systemd: schema válido, 7/7 dimensões, 4 evidências, grounding 1/4, 15.756 tokens de entrada, 1.639 de saída, 13.093 prompt tok/s, 2,80 generation tok/s, 586.368 ms e `finish_reason=stop`. As duas tentativas anteriores da longa foram canceladas pelo timeout padrão de 300s.

O 2-pass na média falhou duas vezes por JSON truncado — primeiro no pass factual com 768 tokens e depois na síntese com 1.536. O teste controlado final foi feito na call curta após aumentar a síntese para 2.048 tokens: concluiu com 2 passes, schema válido, 2 evidências, grounding 2/2, 1.387 tokens de entrada, 1.384 de saída, 318.732 ms e `finish_reason=stop`. Resultado: `/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/qwen-v3-direct-20261015/short/two_pass.json`.

O multipass histórico foi executado somente na call curta, após uma primeira falha no pass de dimensões com orçamento de 768 tokens. A repetição controlada com 1.536 tokens concluiu com schema válido, 5 passes, 6.426 tokens de entrada, 3.524 de saída, 855.670 ms, `finish_reason=stop`, 3/3 evidências grounded e grounding 1,0. Resultado: `real-benchmark/qwen-v3-direct-20261015/short/multipass.json`. O custo foi aproximadamente 2,7x o 2-pass e 5,6x o direct curto.

### Comparação consolidada da etapa histórica

| Estratégia | Call | Schema | Dimensões | Evidências grounded | Score / outcome | Wall time |
|---|---|---:|---:|---:|---|---:|
| direct genérico anterior | `77d37a58-fcb5-40b1-9568-cd3dcb8e88ed` longa | válido | 7/7 | 3/7 (42,9%) | 88 / follow_up | ~41m12s |
| direct + prompt/rubrica v1 | curta | válido | 7/7 | 0/1 (0%) | unscorable / not_sold | 152,955 ms |
| direct + prompt/rubrica v1 | média | válido | 7/7 | 1/3 (33%) | unscorable / not_sold | 551,695 ms |
| direct + prompt/rubrica v1 | longa | válido | 7/7 | 1/4 (25%) | 72 / disqualified | 586,368 ms |
| 2-pass factual → final | curta | válido | 7/7 | 2/2 (100%) | unscorable / unknown | 318,732 ms |
| multipass factual → comercial → dimensões → coaching → final | curta | válido | 7/7 | 3/3 (100%) | unscorable / not_sold | 855,670 ms |

O conjunto é pequeno e a call curta é explicitamente insuficiente para score; portanto não há base para declarar vencedor semântico. A evidência atual favorece o 2-pass como melhor compromisso inicial: grounding perfeito no teste curto, schema válido e cerca de um terço do tempo do multipass. O multipass aumentou a quantidade de evidência grounded de 2 para 3, mas não demonstrou ganho de cobertura (ambos 7/7) nem qualidade comparável por causa do caso unscorable. O direct continua sendo o perfil operacional mais barato em número de inferências; sua taxa de grounding foi baixa nas três calls reais.

Os relatórios por call e o resumo estruturado estão preservados na VPS em `real-benchmark/qwen-v3-direct-20261015/` e localmente, fora do Git, em `artifacts/local-qwen/benchmark/qwen-v3-strategy-report.{json,md}`.

Configuração preliminar recomendada: `direct` para operação econômica e `two_pass` para análises de maior valor/revisão, ambos com JSON Schema, prompt/rubrica v1 e provenance completo. O multipass permanece experimental: no único teste válido teve grounding 100%, mas levou 855,7s e exigiu ajuste de orçamento; não há evidência suficiente para promovê-lo.

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
- `packages/ai_local/ai_local/schema.py` + `intermediate_schema.py`: contratos e validação local;
- `packages/ai_local/ai_local/chunking.py`: chunks por linhas/turnos, origem e overlap;
- `packages/ai_local/ai_local/pipeline.py`: pipeline multi-pass e métricas;
- `packages/ai_local/ai_local/config.py`: perfis day/night, endpoint, contexto e timeout;
- `packages/ai_local/ai_local/cli.py` + `__main__.py`: CLI de shadow mode sem escrita no PostgreSQL, com `--strategy direct|multipass`;
- `ops/local-qwen-runtime.sh`: start/status/stop/logs do servidor localhost com resource guard;
- `ops/local-qwen-job.sh`: jobs systemd resumíveis com status/logs/result/cancel;
- `packages/ai_local/tests/test_local_qwen.py`: testes de schema, chunking, pipeline e grounding;
- `eval/evaluate_local_qwen.py`: métricas determinísticas sem APIs pagas;
- `eval/benchmark_metrics.py` + `eval/tests/test_metrics.py`: JSONL/CSV/Markdown e testes determinísticos;
- `eval/select_reference_corpus.sql`: seleção estratificada read-only;
- `eval/promptfoo/promptfooconfig.yaml`: primeiro caso reproduzível para direct structured analysis.

O provider possui retries limitados para falhas transitórias, rejeita transcrições vazias e a pipeline retorna provenance com hash SHA-256 da transcrição, versão da pipeline, estratégia de análise e estratégia de chunks.

O runtime script foi executado na VPS em perfil `day`: iniciou uma unidade transitória localhost-only, aguardou health `{"status":"ok"}` durante o carregamento do modelo e foi parado explicitamente ao final. O guard de concorrência usa `pgrep -x llama-server`, evitando falsos positivos do próprio shell.

Comando recomendado para amanhã:

```text
QWEN_PROFILE=day ops/local-qwen-runtime.sh start
ops/local-qwen-job.sh start <CALL_ID> <TRANSCRIPT_PATH> artifacts/local-qwen/<CALL_ID>.json direct
ops/local-qwen-job.sh status <CALL_ID>
ops/local-qwen-job.sh result <CALL_ID>
```

O CLI e os jobs operam em shadow mode por padrão: salvam artefato local, métricas e provenance, mas não alteram `analysis_runs`, `analysis_attempts` ou qualquer análise oficial.

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

- 13 GB livres, 72% usado;
- 23 GiB RAM, aproximadamente 10 GiB disponíveis no último check;
- containers existentes observados sem ação;
- Qwen 9B parado após a execução;
- porta `127.0.0.1:18081` livre;
- baseline, smoke tests e benchmarks históricos preservados em diretórios persistentes;
- nenhum container de produção foi parado, reiniciado ou alterado.

## CHECKPOINT PARA PRÓXIMA SESSÃO

Estado atual:

- branch local/remoto: `feat/qwen9b-analysis-v2`;
- working tree deve permanecer limpo após o commit deste checkpoint;
- último commit/checkpoint: `6347fe9` antes desta atualização; consultar `git rev-parse --short HEAD` após o commit atual;
- branch já enviado ao origin;
- System One preservado;
- somente `Qwen3.5-9B-Q4_K_M.gguf` permanece na VPS;
- nenhuma unidade/processo Qwen ativo no último check;
- porta `127.0.0.1:18081` livre no último check;
- disco: 13 GB livres / 72% usado;
- RAM disponível: aproximadamente 10 GiB;
- containers observados sem alteração; worker continua com reinícios e organization-sync unhealthy, ambos pré-existentes.

Resultados persistidos na VPS:

- baseline direto: `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/qwen9b-baseline-20261015_042612/`;
- métricas baseline: `benchmark-metrics.json`, `benchmark-metrics.csv`, `benchmark-metrics.md`;
- structured smoke: `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/qwen9b-structured-smoke-20261015_051534/`;
- multi-pass sintético: `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/qwen9b-multipass-smoke-20261015_051657/`;
- manifesto sem transcrições/PII: `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/reference-corpus-manifest.json`, 180 calls deduplicadas.
- seleção inicial metadata-only: `/home/ubuntu/sales-intelligence-local-llm/real-benchmark/reference-corpus-selection-20.json`, 5 calls por bucket de tamanho.
- execução real do pipeline atual: `/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/artifacts/synthetic-call-20261015.json`, sucesso estruturado, 5 passes, 1 chunk, grounding rate 1.0.
- comparação histórica: `/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/qwen-v3-direct-20261015/`, incluindo direct curta/média/longa, two_pass curta, multipass curta e métricas por variante.

Próximo comando recomendado:

```text
ssh oracle-vps
cd <checkout-do-repositório>
QWEN_PROFILE=day ops/local-qwen-runtime.sh start
ops/analyze-local-call.sh 77d37a58-fcb5-40b1-9568-cd3dcb8e88ed artifacts/local-qwen/77d37a58-shadow.json direct
ops/local-qwen-job.sh status 77d37a58-fcb5-40b1-9568-cd3dcb8e88ed
ops/local-qwen-job.sh result 77d37a58-fcb5-40b1-9568-cd3dcb8e88ed artifacts/local-qwen/77d37a58-shadow.json
```

A análise é shadow-only e não escreve nas tabelas oficiais. O comando acima usa o caminho direto; para a variante 2-pass, use `two_pass`; para multipass, use `multipass` apenas em amostras pequenas. A etapa histórica foi concluída com comparação documentada; não iniciar Qdrant, DSPy, LoRA, worker ou site antes da revisão humana dos resultados e decisão sobre o adapter shadow.

## Estado verificado em 2026-10-16

O pipeline `closer_insider_v1` agora persiste checkpoints globais para `commercial`, `closer_evaluation`, `critic` e `final`, com fingerprints de transcript, upstream, prompt, schema, pipeline/playbook, chunking, orçamento e modelo. A persistência é atômica e incremental; o CLI não sobrescreve mais checkpoints de evidence com artefatos de apresentação.

A call longa `77d37a58-fcb5-40b1-9568-cd3dcb8e88ed` concluiu no Qwen 9B com 514 turns, 8 chunks, 129 evidências, 129/129 grounded, zero quote mismatches e regression determinística `valid=true`. O run reutilizou os oito checkpoints de evidence existentes. Para esta call, `closer_evaluation` precisou de 6144 tokens e `critic` de 3072 após truncamentos observados em 4096 e 1536, respectivamente. O timeout usado foi 5400 s.

O microbenchmark de cache confirmou reutilização real no llama.cpp instalado: prompt idêntico reutilizou 4709/4713 tokens e reduziu wall de 282,192 ms para 1,870 ms; uma pequena alteração no sufixo reutilizou 4197 tokens e levou 34,938 ms. O resultado sanitizado está em `real-benchmark/cache-microbenchmark-20261016.json` na VPS.

O Qwen 4B foi reinstalado de `unsloth/Qwen3.5-4B-GGUF`, filename `Qwen3.5-4B-Q4_K_M.gguf`, tamanho 2,740,937,888 bytes. Benchmark isolado sequencial: 4B load 14,043 ms, prompt 27.71 tok/s, generation 9.12 tok/s; 9B load 26,026 ms, prompt 17.98 tok/s, generation 6.02 tok/s. Os dois modelos não foram inferidos simultaneamente. O full hybrid 4B→9B ainda não foi executado.

Relatório sanitizado versionado: `docs/local-qwen-analysis-v2-report.md`. A recomendação permanece manter o 9B como baseline de qualidade, preservar checkpoint/cache e executar o benchmark híbrido completo antes de trocar a arquitetura.

## Nova filosofia de avaliação: closer-insider-eval-v1

A partir desta etapa, as rubricas `call-analysis-v0/v1`, `insider-demo-v0`, `insider-production-v1` e outputs SOTA são preservados apenas como legado/referência. Eles não são gold truth nem objetivo de otimização do Qwen.

A nova estratégia `closer_insider_v1` analisa somente `Closer × Insider`, sem score global como centro da avaliação. O fluxo é: evidence extraction → merge/ledger determinístico → reconstrução comercial → avaliação qualitativa do Closer → critic cético → síntese final.

A spec versionada está em `packages/ai_local/ai_local/closer-insider-eval-v1.playbook.json` e os contratos em `closer-insider-eval-v1.schemas.json`. A provenance usa `pipeline_version=closer-insider-v1`, `schema_version=closer-insider-eval-v1` e `playbook_version=closer-insider-playbook-v1`.

O ledger atribui IDs determinísticos `T000001...` aos turnos e `E000001...` às evidências. O modelo retorna apenas `turn_id`, claim e tipo; Python hidrata speaker, timestamp e texto exato. Passes posteriores só recebem `evidence_ids`; IDs inexistentes são rejeitados. Outcome sem evidência explícita é normalizado para `unknown`.

### Primeira call real da nova estratégia

Call processada: `facfd6f3-ee0f-4046-8966-363a41e2c831`, transcrição verbatim extraída do bloco `Transcrição` do transcript real. O primeiro resultado válido está em `/home/ubuntu/sales-intelligence-local-llm/pipeline-v2/real-benchmark/closer-insider-v1/closer-insider-v1/`.

Resultado validado: 20 evidências, 20/20 grounded, timestamps presentes, 6 passes, 2 chunks, 1.930.526 ms, 26.462 tokens de entrada, 6.135 tokens de saída e schema válido. O estado comercial separou `current_opportunity_fit=low` de `future_requalification_potential=medium` e manteve `outcome=unknown` por ausência de evidência explícita de venda/não venda.

Achados qualitativos do Qwen:
- pontos fortes: tom profissional, esclarecimento do propósito e identificação de janela futura de disponibilidade;
- falhas materiais: perda de controle da agenda, expectativa de duração apresentada antes de validar disponibilidade, discovery superficial, ausência de qualificação de autoridade/orçamento/processo decisório e fechamento sem data/hora concreta;
- oportunidade perdida: transformar a restrição de 30–40 minutos em escopo reduzido ou compromisso específico;
- radar, não culpa: confusão do prospect sobre a origem da call pode indicar problema de qualidade/SDR anterior;
- erro corrigido após a primeira execução: timestamps estavam em linhas separadas e foram associados deterministicamente ao turno seguinte; `not_sold` sem evidência explícita passou a ser `unknown`.

Uma segunda execução, na call longa `77d37a58-fcb5-40b1-9568-cd3dcb8e88ed`, foi tentada com `QWEN_MAX_TURNS=300` e `QWEN_OVERLAP_TURNS=30`, mas falhou imediatamente com HTTP 400 no primeiro chunk: o tamanho do request excedeu o limite efetivo do endpoint/contexto. Não houve escrita no banco oficial. O próximo teste da longa deve usar chunks menores (por exemplo, 80–120 turnos) ou uma estratégia de sumarização incremental antes da avaliação.
