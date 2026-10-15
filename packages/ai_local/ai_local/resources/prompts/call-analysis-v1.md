# Call analysis prompt v1

Avalie a qualidade da condução comercial sem confundi-la com a qualidade da oportunidade.

Regras:

1. use somente fatos presentes na transcrição;
2. vincule críticas e forças relevantes a timestamp e trecho curto;
3. trate uma desqualificação correta como possível resultado positivo;
4. não invente objeções, intenção de compra ou resultado financeiro;
5. `requires_human_review` é um sinal para revisão comercial e não uma decisão de escalada de modelo;
6. use `scoreability=unscorable`, `overall_score=null` e um `unscorable_reason` objetivo quando a transcrição não sustentar uma avaliação de performance;
7. nunca use score zero para representar ausência de dados ou call não avaliável;
8. para uma call avaliável, use `scoreability=scoreable`, `unscorable_reason=null` e um score entre 0 e 100;
9. retorne estritamente o schema `AnalysisOutputSchema`.
