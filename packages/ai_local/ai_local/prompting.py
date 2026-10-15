from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


RESOURCE_DIR = Path(__file__).with_name("resources")
SCHEMA_VERSION = "analysis-output-v2-with-intermediates-v1"
DIMENSION_MEANINGS = {
    "opening_rapport": "abertura clara, contexto, escuta inicial e rapport profissional",
    "discovery": "perguntas relevantes para entender situação, processo e contexto",
    "qualification": "qualificação de fit, urgência, autoridade, processo e restrições",
    "diagnosis": "conexão entre problema, impacto, causa e necessidade do lead",
    "value_presentation": "valor apresentado conectado às necessidades demonstradas",
    "objection_handling": "identificação e tratamento de objeções explícitas sem inventá-las",
    "closing_next_steps": "próximos passos claros, compromisso e combinação verificável",
}


@dataclass(frozen=True)
class HistoricalContext:
    prompt_version: str
    rubric_version: str
    schema_version: str
    prompt_text: str
    rubric: dict[str, Any]

    @property
    def dimensions(self) -> list[dict[str, Any]]:
        return list(self.rubric.get("dimensions", []))

    def dimension_text(self, keys: list[str] | None = None) -> str:
        selected = keys or [item["key"] for item in self.dimensions]
        lines = []
        for item in self.dimensions:
            if item["key"] in selected:
                meaning = DIMENSION_MEANINGS.get(item["key"], "avalie somente o que estiver sustentado pela evidência")
                lines.append(f"- {item['key']} ({item['label']}, peso {item['weight']}): {meaning}.")
        return "\n".join(lines)


def load_historical_context(prompt_version: str = "call-analysis-v1", rubric_version: str = "v1") -> HistoricalContext:
    prompt_path = RESOURCE_DIR / "prompts" / f"call-analysis-{prompt_version.rsplit('-', 1)[-1]}.md"
    rubric_path = RESOURCE_DIR / "rubrics" / f"rubric.{rubric_version}.json"
    prompt_text = prompt_path.read_text(encoding="utf-8")
    rubric = json.loads(rubric_path.read_text(encoding="utf-8"))
    return HistoricalContext(
        prompt_version=prompt_version,
        rubric_version=str(rubric["id"]),
        schema_version=SCHEMA_VERSION,
        prompt_text=prompt_text,
        rubric=rubric,
    )


def direct_system_prompt(context: HistoricalContext) -> str:
    return "\n\n".join(
        [
            context.prompt_text,
            f"Base comercial versionada: rubric_version={context.rubric_version}, schema_version={context.schema_version}.",
            "Dimensões e significado:",
            context.dimension_text(),
            "Grounding obrigatório: toda evidência deve ser uma citação exata da transcrição; não invente timestamp. Se não houver timestamp, use string vazia. Não transforme conhecimento externo em fala do lead.",
            "Consistência: score, oportunidade, outcome, confiança, dimensões, forças, falhas, objeções e coaching devem ser compatíveis com as evidências. Quando os dados não sustentarem avaliação, siga as regras de scoreability da rubrica v1.",
        ]
    )


def factual_system_prompt(context: HistoricalContext) -> str:
    return "\n\n".join(
        [
            "Extraia somente fatos observáveis da transcrição. Não avalie o vendedor nesta etapa.",
            "Regras: não inventar; preservar quote exata; registrar chunk_id e posições recebidas; separar pergunta, dor, objetivo, restrição, objeção, compromisso e decisão; se algo não estiver explícito, não crie o fato.",
            f"prompt_version={context.prompt_version}; rubric_version={context.rubric_version}. A rubrica completa não é necessária nesta etapa.",
        ]
    )


def commercial_system_prompt(context: HistoricalContext) -> str:
    return "\n\n".join(
        [
            "Inferir o estado comercial somente a partir dos fatos estruturados recebidos. Não retornar fatos novos sem fact_id ou evidência correspondente.",
            "Avalie situação, problema, implicação, necessidade, qualificação, capacidade/restrição financeira, decisores, objeções e próximos passos. Ausência de informação deve permanecer desconhecida, não ser preenchida por suposição.",
            f"rubric_version={context.rubric_version}; critérios relevantes: qualification, diagnosis, closing_next_steps.",
        ]
    )


def dimensions_system_prompt(context: HistoricalContext) -> str:
    return "\n\n".join(
        [
            "Avalie somente as dimensões abaixo usando os fatos e estado comercial recebidos. Não reanalise a transcrição nem invente evidência.",
            context.dimension_text(),
            "Cada rationale deve explicar o score com base em fact_ids. Uma dimensão pode ter score baixo por ausência de comportamento observável, mas não confunda ausência de evidência com falha crítica sem suporte.",
            f"rubric_version={context.rubric_version}; evidence_required={context.rubric.get('evidence_required', True)}.",
        ]
    )


def coaching_system_prompt(context: HistoricalContext) -> str:
    return "\n\n".join(
        [
            "Produza coaching acionável a partir somente do estado comercial e da avaliação estruturada recebida.",
            "Separe strengths, critical_failures e coaching_actions. Não crie objeções, fatos ou resultados. Uma falha crítica precisa ser sustentada por comportamento observável ou por ausência relevante dentro de uma dimensão avaliável.",
            context.prompt_text,
        ]
    )


def final_system_prompt(context: HistoricalContext) -> str:
    return "\n\n".join(
        [
            context.prompt_text,
            "Monte o resultado final a partir dos artefatos estruturados recebidos. Preserve somente evidências rastreáveis, mantenha todas as dimensões da rubrica e retorne estritamente o JSON Schema fornecido pelo sistema.",
            context.dimension_text(),
            f"prompt_version={context.prompt_version}; rubric_version={context.rubric_version}; schema_version={context.schema_version}.",
        ]
    )
