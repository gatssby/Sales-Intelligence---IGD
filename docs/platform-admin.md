# Platform Admin e auditoria das superfícies administrativas

## Classificação

- **A — comercial/operacional:** decisão e desempenho de vendas.
- **B — pessoas/times:** identidade, conta, vínculo e organização.
- **C — integridade operacional:** exceções que exigem decisão da operação.
- **D — técnico/platform:** execução, infraestrutura, providers e diagnóstico interno.
- **E — ambíguo:** mistura C/D que precisa de uma apresentação separada.

## Auditoria do app anterior

| Superfície ou item | Classe | Destino | Razão |
| --- | --- | --- | --- |
| Visão Geral, métricas, rankings e coaching | A | Todos conforme Effective Access | Resultado comercial direto. |
| Calls, análise, evidências e transcript sob demanda | A | Todos conforme Effective Access | Trabalho comercial e coaching. |
| Pessoas, Times e Organização | A/B | Todos conforme Effective Access | Estrutura e desempenho no escopo permitido. |
| Usuários e Acessos | B | Admin e Platform Admin | Gestão comercial de contas e vínculo com Person. Platform Admin não pode ser concedido aqui. |
| Integridade: closer, V-code, produto, frente, time e classificação | C | Admin e Platform Admin | Exceções acionáveis pela operação. |
| Drive: documentos sem closer/classificação/atribuição | C | Admin e Platform Admin | Contagens que exigem decisão operacional, sem cursor, lease ou erro bruto. |
| Organization Sync: contagens, warnings e mudanças publicadas | C | Admin e Platform Admin | Estado organizacional necessário para decisões operacionais. |
| Organization Sync: revision, erro técnico e acionamento manual | D | Platform Admin | Diagnóstico e operação da integração. |
| Organization Sync e progresso antes da separação | E | Divididos em C e D | As superfícies originais misturavam decisão operacional e diagnóstico interno. |
| Backlog: totais, aguardando transcript, revisão e falhas agregadas | C | Usuários comerciais conforme escopo | Estado operacional compreensível sem infraestrutura. |
| Stages internos, modelo ativo, workers, leases e heartbeats | D | Platform Admin | Implementação e diagnóstico do pipeline. |
| Drive cursor, scans e discovery técnico | D | Platform Admin | Estado interno da integração; o valor do cursor nunca é exibido. |
| AI Gateway, budget, reconciliação, custo e concorrência | D | Platform Admin | Controle técnico de gasto e execução. |
| Provider/model, tentativas, latency, error code, prompt/schema/rubric version | D | Platform Admin | Auditoria técnica; Admin recebe somente o registro operacional da análise. |
| Health, release SHA, schema version e códigos de erro sanitizados | D | Platform Admin | Observabilidade sem secrets ou erros brutos. |

## Information architecture resultante

A navegação comercial permanece curta: Visão Geral, Pessoas, Times, Calls, Organização e Coaching. O grupo Admin contém Usuários e Acessos, Sincronização operacional e Integridade. O grupo Platform possui uma única entrada, Operação técnica, que agrupa Saúde, Integrações, Discovery, Workers/Jobs, Logs/Erros, IA/Custos, Sincronizações e Diagnósticos.

## Preview Mode

O controle **Visualizar como** aparece somente para o ator `PLATFORM_ADMIN`. Admin é uma visão comercial global; Supervisor, Líder e Pessoa exigem uma persona e reutilizam as relações temporais de `EffectiveAccess`. O cookie de seleção não contém credencial e não concede acesso: o servidor valida ator e persona a cada request. Alterar a URL continua aplicando a interseção PostgreSQL do scope. O modo ativo mantém indicação persistente e todas as mutations permanecem bloqueadas até **Sair da visualização**.
