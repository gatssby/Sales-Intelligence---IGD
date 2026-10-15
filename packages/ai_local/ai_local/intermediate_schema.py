from __future__ import annotations

from typing import Any


def _object(required: list[str], properties: dict[str, Any], *, additional_properties: bool = False) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": additional_properties,
        "required": required,
        "properties": properties,
    }


FACTS_JSON_SCHEMA: dict[str, Any] = _object(
    ["facts"],
    {
        "facts": {
            "type": "array",
            "items": _object(
                ["fact_id", "kind", "claim", "quote", "chunk_id", "source_start", "source_end"],
                {
                    "fact_id": {"type": "string"},
                    "kind": {"type": "string", "enum": ["participant", "number", "pain", "goal", "constraint", "question", "objection", "commitment", "decision", "other"]},
                    "claim": {"type": "string"},
                    "quote": {"type": "string"},
                    "chunk_id": {"type": "string"},
                    "source_start": {"type": "integer", "minimum": 0},
                    "source_end": {"type": "integer", "minimum": 0},
                },
            ),
        }
    },
)

COMMERCIAL_JSON_SCHEMA: dict[str, Any] = _object(
    ["situation", "problem", "implication", "need", "qualification", "financial_capacity", "decision_makers", "commercial_state", "objections", "next_steps"],
    {
        "situation": {"type": "string"},
        "problem": {"type": "string"},
        "implication": {"type": "string"},
        "need": {"type": "string"},
        "qualification": {"type": "string"},
        "financial_capacity": {"type": "string"},
        "decision_makers": {"type": "array", "items": {"type": "string"}},
        "commercial_state": {"type": "string", "enum": ["new", "qualified", "proposal", "follow_up", "won", "lost", "disqualified", "unknown"]},
        "objections": {"type": "array", "items": {"type": "string"}},
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
)

DIMENSIONS_JSON_SCHEMA: dict[str, Any] = _object(
    ["dimensions"],
    {
        "dimensions": {
            "type": "array",
            "items": _object(
                ["key", "label", "score", "rationale", "fact_ids"],
                {
                    "key": {"type": "string"},
                    "label": {"type": "string"},
                    "score": {"type": "number", "minimum": 0, "maximum": 100},
                    "rationale": {"type": "string"},
                    "fact_ids": {"type": "array", "items": {"type": "string"}},
                },
            ),
        }
    },
)

COACHING_JSON_SCHEMA: dict[str, Any] = _object(
    ["strengths", "critical_failures", "coaching_actions"],
    {
        "strengths": {"type": "array", "items": {"type": "string"}},
        "critical_failures": {"type": "array", "items": {"type": "string"}},
        "coaching_actions": {"type": "array", "items": {"type": "string"}},
    },
)

INTERMEDIATE_SCHEMAS = {
    "facts": FACTS_JSON_SCHEMA,
    "commercial": COMMERCIAL_JSON_SCHEMA,
    "dimensions": DIMENSIONS_JSON_SCHEMA,
    "coaching": COACHING_JSON_SCHEMA,
}
