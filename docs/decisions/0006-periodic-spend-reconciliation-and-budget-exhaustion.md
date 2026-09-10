# ADR 0006 — Reconciliação periódica de spend e esgotamento normal de budget

## Status

Aceita em 2026-09-09.

## Contexto

O ledger PostgreSQL já reserva o custo conservador antes de cada request e liquida o receipt do Gateway. Exigir também uma consulta ao control plane da Vercel antes de toda inferência duplicava a proteção, aumentava latência e transformava indisponibilidade do endpoint de leitura em parada do worker. A reserva anterior de US$ 3 também deixava crédito autorizado sem uso.

## Decisão

- O hot path pago exige reserva atômica no ledger PostgreSQL, sob lock da conta global.
- O settlement usa `providerMetadata.gateway.cost`; receipt ausente continua sendo estado desconhecido e recuperável, nunca custo zero.
- A leitura do spend agregado da key Vercel ocorre periodicamente e em startup quando as credenciais de gestão estão disponíveis. Ela só pode elevar o piso reconciliado.
- Falha temporária nessa leitura não bloqueia requests que ainda cabem no ledger persistido.
- O teto é o budget da key menos uma margem técnica pequena e configurável, inicialmente US$ 0,10.
- Se a próxima reserva não couber, ou o Provider responder 402, a conta e a Call ficam pausadas por budget. Nenhuma das duas situações é registrada como falha semântica da análise.
- Um 402 sem receipt libera a reserva iniciada e preserva o attempt com custo desconhecido; ele não cria falsa despesa zero nem exige retry técnico.
- O painel administrativo consome apenas um read model PostgreSQL agregado. Médias e capacidade estimada ignoram custos desconhecidos e declaram a janela usada.

## Consequências

Dois workers continuam compartilhando o mesmo teto global e não conseguem reservar acima dele. O processamento permanece seguro durante indisponibilidade temporária do endpoint de gestão da Vercel e para normalmente perto do limite real. A reconciliação posterior corrige drift externo sem duplicar receipts já liquidados.
