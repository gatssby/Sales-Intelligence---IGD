# Sales Intelligence IGD

O domínio transforma transcrições de calls comerciais em avaliações auditáveis, preservando identidade, histórico e a separação entre experimentos e resultados oficiais.

## Calls e transcrições

**Call**:
Conversa comercial canônica identificada, neste MVP, pelo `transcript_file_id` do Google Drive. Uma Call pode ter múltiplas origens sem mudar de identidade.
_Evite_: reunião, linha do CRM

**Transcript**:
Versão persistida do conteúdo textual de uma Call, identificada também por hash do conteúdo. Uma Call pode ganhar novas versões de Transcript sem apagar as anteriores.
_Evite_: notas, documento

## Avaliação

**Analysis Run**:
Processo lógico que avalia um Transcript com versões explícitas de rubrica, prompt, schema e estratégia. Pode conter várias Analysis Attempts e só se torna oficial após conclusão válida.
_Evite_: request, chamada ao modelo

**Analysis Attempt**:
Uma invocação auditável de um Model durante um Analysis Run, seja primary, retry técnico ou escalation.
_Evite_: analysis run, análise oficial

**Official Analysis**:
Analysis Run de produção concluído e elegível para métricas do produto. Benchmark Results nunca são Official Analyses.
_Evite_: benchmark aprovado

**Current Analysis**:
Única Official Analysis atualmente selecionada para representar uma Call no dashboard. O histórico anterior permanece preservado.
_Evite_: última tentativa

**Primary Analysis**:
Primeira função de modelo na estratégia de produção, destinada a resolver a maioria das Calls com custo e latência controlados.
_Evite_: modelo padrão

**Escalation Analysis**:
Função de modelo mais capaz acionada uma única vez quando a Primary Analysis não passa pelo Confidence Gate ou falha segundo a política.
_Evite_: retry

**Confidence**:
Estimativa de 0 a 1 produzida pelo Model sobre a confiabilidade de sua própria análise. É um sinal do Confidence Gate, não uma medida independente de qualidade.
_Evite_: qualidade, certeza factual

**Confidence Gate**:
Política que combina Confidence com sinais verificáveis de schema, grounding, cobertura e consistência para aceitar a Primary Analysis ou exigir escalation.
_Evite_: limiar de confiança isolado

**Escalation Reason**:
Motivo canônico e auditável pelo qual uma Primary Analysis não foi aceita, como baixa confiança, evidência sem grounding, schema inválido, timeout ou erro técnico.
_Evite_: mensagem livre de erro

## Experimentos

**Benchmark Run**:
Experimento controlado que compara Models sobre uma amostra fixa, com a mesma rubrica, prompt e schema. Não altera KPI nem Current Analysis.
_Evite_: analysis run oficial

**Benchmark Result**:
Resultado de um único Model sobre uma Call dentro de um Benchmark Run. Permanece isolado de Official Analyses mesmo quando seu conteúdo é válido.
_Evite_: official analysis

## Versionamento e operação

**Rubric Version**:
Identidade imutável do conjunto de critérios e pesos usados para avaliar uma Call.

**Prompt Version**:
Identidade imutável das instruções enviadas ao Model.

**Schema Version**:
Identidade imutável do contrato estruturado exigido para o resultado.

**Model**:
Slug versionado do modelo de IA executado por um Provider.

**Provider**:
Origem operacional que executa um Model; nesta fase, o Vercel AI Gateway é o provider da aplicação e roteia para os fabricantes dos Models.

**Cost**:
Valor em dólares atribuído a uma Analysis Attempt ou Benchmark Result a partir do uso retornado e do preço vigente registrado.

**Official Call Cost**:
Soma dos receipts conhecidos das Analysis Attempts de uma Official Analysis. Custo ausente permanece desconhecido e nunca é convertido em zero.
_Evite_: custo estimado da call

**Reconciled Spend**:
Maior piso conhecido do gasto agregado da key, formado pela baseline externa reconciliada e pelos settlements oficiais persistidos.
_Evite_: saldo instantâneo garantido

**AI Spend Summary**:
Read model administrativo, sem chamadas de IA, que apresenta budget, Reconciled Spend, médias recentes e capacidade estimada a partir de custos oficiais conhecidos.
_Evite_: ledger financeiro

**Budget Exhaustion**:
Pausa operacional normal quando a próxima reserva não cabe no teto ou quando o Provider responde que não há crédito. Não é falha da Call.
_Evite_: erro de análise

**Latency**:
Tempo de ponta a ponta, em milissegundos, de uma invocação ao Model.
