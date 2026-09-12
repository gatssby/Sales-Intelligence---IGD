# ADR 0010 — Cargo organizacional e acesso derivado

## Status

Aceita em 2026-09-11.

## Contexto

A organização oficial já define Pessoas, Produtos, Frentes, Times, liderança, Líder em treinamento e Supervisor, mas as contas ainda expunham perfis manuais parcialmente redundantes. Isso permitia divergência entre a função vigente da Person e a abrangência registrada na conta. Ao mesmo tempo, Administrador comercial e Administrador da Plataforma precisam continuar sendo autoridades distintas.

## Decisão

- O Cargo Organizacional canônico é Closer, SDR, Líder, Líder em treinamento, Supervisor ou Administrador.
- Supervisor e Líder em treinamento vêm de marcadores explícitos; Líder vem da referência por código V; Closer, SDR e Administrador vêm do valor exato de Cargo. A precedência é Supervisor, Líder em treinamento, Líder e Cargo.
- Cargo e vínculo são temporais. Mudanças encerram o intervalo anterior e começam outro no instante observado, sem reescrever o passado.
- Contas comerciais novas guardam apenas o vínculo com Person. Cargo e abrangência são recalculados no PostgreSQL: Closer/SDR veem a própria Person; Líder e Líder em treinamento veem seus Times; Supervisor vê o Produto; Administrador vê toda a operação comercial.
- Um Administrador pode gerenciar contas e configurações comerciais, mas não recebe diagnóstico técnico nem `spend:execute`.
- Administrador da Plataforma permanece autoridade interna explícita, fora do vocabulário da planilha e fora da gestão comercial. Somente ele observa/opera a Plataforma, executa gasto autorizado e usa Visualizar como.
- Sinais inválidos ou conflitantes preservam o cargo anterior. A planilha nunca promove alguém a Administrador da Plataforma.
- FL e INSIDER são produtos analíticos. Ingressos permanece no grafo organizacional e no histórico, porém não aparece na navegação, filtros ou listagens analíticas.
- Perfis manuais históricos permanecem legíveis para rollback; contas já vinculadas migram para acesso derivado. Novos perfis manuais são rejeitados no servidor.

## Consequências

Uma troca de cargo passa a alterar o acesso no request seguinte, sem editar a conta. A matriz fica centralizada e testável no servidor e no SQL, enquanto o navegador apenas escolhe recortes autorizados. O início dessa política cria fatos atuais suportados pelos dados já publicados, mas não inventa intervalos históricos anteriores à migração.

Administrador da Plataforma concentra superfícies técnicas e conserva o ator real durante Visualizar como; qualquer mutation ou operação paga é bloqueada nesse modo. Ingressos continua disponível para consistência organizacional e evolução futura sem poluir a experiência analítica atual.
