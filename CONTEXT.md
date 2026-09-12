# Sales Intelligence IGD

O domínio transforma transcrições de calls comerciais em avaliações auditáveis, preservando identidade, histórico e a separação entre experimentos e resultados oficiais.

## Calls e transcrições

**Drive Source**:
Pasta-raiz do Google Drive explicitamente habilitada para descoberta. Um item em Compartilhados comigo é apenas candidato a Drive Source até aprovação.
_Evite_: pasta de vendedor, árvore do banco

**Drive Document**:
Arquivo catalogado pelo ID estável do Google antes de necessariamente ser reconhecido como Transcript ou vinculado a uma Call.
_Evite_: Call, nome do arquivo, link do CRM

**Call**:
Conversa comercial canônica identificada, neste MVP, pelo `transcript_file_id` do Google Drive. Uma Call pode ter múltiplas origens sem mudar de identidade.
_Evite_: reunião, linha do CRM

**Transcript**:
Versão persistida do conteúdo textual de uma Call, identificada também por hash do conteúdo. Uma Call pode ganhar novas versões de Transcript sem apagar as anteriores.
_Evite_: notas, documento

**Person**:
Identidade canônica de uma pessoa da IGD, com códigos, e-mails e aliases como evidências que apontam para a mesma identidade.
_Evite_: usuário da aplicação, líder como pessoa separada

**Seller Profile**:
Perfil comercial compatível associado a uma Person e usado pelo catálogo legado de vendedores.
_Evite_: identidade duplicada da pessoa

**Primary Closer**:
Person especificamente atribuída como responsável principal por uma Call. Outros participantes IGD permanecem participantes e não viram Primary Closer por presença.
_Evite_: primeiro participante encontrado

**Attribution**:
Decisão auditável que liga um Drive Document a uma Person, com método, confiança e estado de revisão.
_Evite_: palpite sem provenance

**Team Membership**:
Relação temporal entre Person e Team, válida desde `valid_from` até `valid_to` exclusivo. A atribuição organizacional de uma Call usa a relação válida na data da Call.
_Evite_: time atual aplicado ao histórico

**Team Leadership**:
Relação temporal em que uma Person exerce liderança sobre um Team.
_Evite_: Leader como entidade de pessoa separada

**Organization Snapshot**:
Estado organizacional atual observado em uma fonte oficial e aceito como confiável para publicação. Um snapshot rejeitado nunca substitui o último estado válido.
_Evite_: planilha como histórico, árvore rígida

**Cargo Organizacional**:
Responsabilidade comercial temporal de uma Person publicada pela Organização IGD: Closer, SDR, Líder, Líder em treinamento, Supervisor ou Administrador.
_Evite_: Perfil de Acesso Manual, conta, privilégio técnico

**Origem do Acesso**:
Autoridade que mantém o cargo comercial e a abrangência de uma conta: Organização IGD ou Manual. Administração da Plataforma é uma autoridade de sistema separada, não uma origem comercial.
_Evite_: override, origem da Person, campo técnico exibido ao usuário

**Acesso Organização IGD**:
Acesso comercial cuja Person vinculada recebe Cargo e abrangência da organização oficial sincronizada.
_Evite_: perfil duplicado, acesso manual vinculado

**Acesso Manual**:
Acesso comercial mantido no Sales Intelligence para uma conta que não depende da organização oficial; usa um Perfil de Acesso Manual e somente a abrangência exigida por esse perfil.
_Evite_: exceção, legado, permissão arbitrária

**Perfil de Acesso Manual**:
Responsabilidade comercial administrada no Sales Intelligence como Closer, SDR, Líder, Líder em treinamento, Supervisor ou Administrador. Closer e SDR exigem Person; Líderes exigem Times; Supervisor exige um Produto; Administrador é comercial global.
_Evite_: Cargo Organizacional, RBAC, combinação livre de escopos

**Vínculo Organizacional Disponível**:
Estado de uma conta Manual cuja Person vinculada passou a existir na Organização IGD. Indica possibilidade de conversão revisada sem alterar automaticamente o acesso.
_Evite_: conversão automática, correspondência por nome

**Autoridade da Conta**:
Limite interno da conta do aplicativo. Uma conta comercial usa Acesso Organização IGD ou Acesso Manual; uma conta técnica pode receber Administração da Plataforma somente por concessão interna explícita.
_Evite_: Cargo Organizacional, Selected Scope, papel inferido pelo navegador

**Administrador da Plataforma**:
Autoridade global reservada ao mantenedor técnico. Inclui observabilidade, integrações, budgets, workers, saúde, diagnósticos e operações técnicas explicitamente autorizadas; nunca é concedida pela organização.
_Evite_: Administrador sênior, Supervisor global, cargo da planilha

**Administrador**:
Cargo Organizacional com visão comercial global e gestão de usuários, vínculos, integridade e configurações comerciais, sem diagnósticos internos da Plataforma. Contas administrativas anteriores podem preservar a mesma autoridade comercial durante a transição.
_Evite_: Administrador da Plataforma, operador de infraestrutura

**Acesso Efetivo**:
Abrangência vigente calculada no servidor a partir da Autoridade da Conta e da Origem do Acesso. Pode vir da organização temporal ou do Perfil de Acesso Manual e corresponde à própria Person, Times, Produto, operação comercial global ou Plataforma global.
_Evite_: filtro visual, escolha gravada na conta, escopo enviado pelo cliente

**Selected Scope**:
Recorte navegacional escolhido dentro do Acesso Efetivo para parametrizar os mesmos read models de análise.
_Evite_: permissão, dashboard separado por papel

**Preview Mode**:
Visão somente leitura iniciada por Administrador da Plataforma que preserva o ator autenticado e aplica aos read models o Acesso Efetivo de um Cargo Organizacional.
_Evite_: impersonation, troca de sessão, login como outra pessoa

**Preview Subject**:
Person e Cargo Organizacional cujo Acesso Efetivo é aplicado durante Preview Mode. Nunca substitui o ator autenticado na auditoria.
_Evite_: usuário autenticado, impersonation, token delegado

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
