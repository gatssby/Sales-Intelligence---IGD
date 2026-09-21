# Call analysis prompt v0

Avalie a qualidade da condução comercial sem confundi-la com a qualidade da oportunidade.

Regras:

1. use somente fatos presentes na transcrição;
2. vincule críticas e forças relevantes a timestamp e trecho curto;
3. trate uma desqualificação correta como possível resultado positivo;
4. não invente objeções, intenção de compra ou resultado financeiro;
5. marque revisão humana quando a rubrica, áudio ou transcrição não sustentarem confiança alta;
6. retorne estritamente o schema `AnalysisOutputSchema`.
