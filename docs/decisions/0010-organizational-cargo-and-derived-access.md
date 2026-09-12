# ADR 0010 — Cargo organizacional e acesso derivado

## Status

Aceita em 2026-09-11.

## Contexto

A organização oficial define Pessoas, Produtos, Frentes, Times, liderança, Líder em treinamento e Supervisor para quem está representado nela. Entretanto, existem usuários legítimos do Sales Intelligence que não aparecem nessa fonte e precisam de acesso comercial administrado diretamente no produto. Administrador comercial e Administrador da Plataforma também precisam continuar sendo autoridades distintas.

## Decisão

- O Cargo Organizacional canônico é Closer, SDR, Líder, Líder em treinamento, Supervisor ou Administrador.
- Supervisor e Líder em treinamento vêm de marcadores explícitos; Líder vem da referência por código V; Closer, SDR e Administrador vêm do valor exato de Cargo. A precedência é Supervisor, Líder em treinamento, Líder e Cargo.
- Cargo e vínculo são temporais. Mudanças encerram o intervalo anterior e começam outro no instante observado, sem reescrever o passado.
- Toda conta comercial possui uma Origem do Acesso explícita: Organização IGD ou Manual. Ambas resolvem pelo mesmo módulo central de capacidades e pelo mesmo read model PostgreSQL.
- Contas Organização IGD guardam o vínculo com Person. Cargo e abrangência são recalculados no PostgreSQL: Closer/SDR veem a própria Person; Líder e Líder em treinamento veem seus Times; Supervisor vê o Produto; Administrador vê toda a operação comercial.
- Contas Manuais guardam um Perfil de Acesso Manual válido: Closer/SDR exigem Person; Líder e Líder em treinamento exigem um ou mais Times; Supervisor exige exatamente um Produto; Administrador não aceita escopo adicional.
- Uma Person pode ser vinculada a uma conta Manual sem tornar seu acesso organizacional. Se essa Person passar a ser gerenciada pela organização, a conta recebe o estado Vínculo Organizacional Disponível e só muda para Organização IGD após confirmação administrativa auditada.
- Um Administrador pode gerenciar contas e configurações comerciais, mas não recebe diagnóstico técnico nem `spend:execute`.
- Administrador da Plataforma permanece autoridade interna explícita, fora do vocabulário da planilha e fora da gestão comercial. Somente ele observa/opera a Plataforma, executa gasto autorizado e usa Visualizar como.
- Sinais inválidos ou conflitantes preservam o cargo anterior. A planilha nunca promove alguém a Administrador da Plataforma.
- FL e INSIDER são produtos analíticos. Ingressos permanece no grafo organizacional e no histórico, porém não aparece na navegação, filtros ou listagens analíticas.
- Perfis históricos sem correspondência inequívoca permanecem funcionais e identificados para revisão. Apenas contas vinculadas a uma Person já gerenciada pela organização migram para Organização IGD; novas contas Manuais são aceitas somente nas combinações canônicas.

## Consequências

Uma troca de cargo altera no request seguinte apenas contas Organização IGD. Contas Manuais mantêm perfil e abrangência durante sincronizações. A matriz fica centralizada e testável no servidor e no SQL, enquanto o navegador apenas escolhe recortes autorizados. O início dessa política cria fatos atuais suportados pelos dados já publicados, mas não inventa intervalos históricos anteriores à migração.

Administrador da Plataforma concentra superfícies técnicas e conserva o ator real durante Visualizar como; qualquer mutation ou operação paga é bloqueada nesse modo. Ingressos continua disponível para consistência organizacional e evolução futura sem poluir a experiência analítica atual.
