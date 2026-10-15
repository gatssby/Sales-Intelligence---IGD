from __future__ import annotations

from typing import Any


ANALYSIS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "scoreability", "unscorable_reason", "overall_score", "opportunity_quality",
        "opportunity_quality_label", "call_outcome", "call_outcome_label", "confidence",
        "executive_summary", "strengths", "critical_failures", "objections",
        "coaching_actions", "dimensions", "evidence", "requires_human_review",
    ],
    "properties": {
        "scoreability": {"type": "string", "enum": ["scoreable", "unscorable"]},
        "unscorable_reason": {"type": ["string", "null"]},
        "overall_score": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
        "opportunity_quality": {"type": "string", "enum": ["high", "medium", "low", "unqualified", "unknown"]},
        "opportunity_quality_label": {"type": "string"},
        "call_outcome": {"type": "string", "enum": ["sold", "not_sold", "disqualified", "follow_up", "unknown"]},
        "call_outcome_label": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "executive_summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "critical_failures": {"type": "array", "items": {"type": "string"}},
        "objections": {"type": "array", "items": {"type": "string"}},
        "coaching_actions": {"type": "array", "items": {"type": "string"}},
        "dimensions": {"type": "array", "items": {"$ref": "#/$defs/dimension"}},
        "evidence": {"type": "array", "items": {"$ref": "#/$defs/evidence"}},
        "requires_human_review": {"type": "boolean"},
    },
    "$defs": {
        "dimension": {
            "type": "object", "additionalProperties": False,
            "required": ["key", "label", "score", "rationale"],
            "properties": {"key": {"type": "string"}, "label": {"type": "string"}, "score": {"type": "number", "minimum": 0, "maximum": 100}, "rationale": {"type": "string"}},
        },
        "evidence": {
            "type": "object", "additionalProperties": False,
            "required": ["timestamp", "speaker", "criterion", "quote", "interpretation"],
            "properties": {"timestamp": {"type": "string"}, "speaker": {"type": "string"}, "criterion": {"type": "string"}, "quote": {"type": "string"}, "interpretation": {"type": "string"}},
        },
    },
}


def validation_errors(value: Any) -> list[str]:
    if not isinstance(value, dict):
        return ["root"]
    errors: list[str] = []
    required = ANALYSIS_JSON_SCHEMA["required"]
    for key in required:
        if key not in value:
            errors.append(key)
    if value.get("scoreability") not in {"scoreable", "unscorable"}:
        errors.append("scoreability")
    if value.get("scoreability") == "scoreable":
        if not isinstance(value.get("overall_score"), (int, float)):
            errors.append("overall_score")
        if value.get("unscorable_reason") is not None:
            errors.append("unscorable_reason")
    if value.get("scoreability") == "unscorable":
        if value.get("overall_score") is not None:
            errors.append("overall_score")
        if not isinstance(value.get("unscorable_reason"), str) or not value["unscorable_reason"].strip():
            errors.append("unscorable_reason")
    if not 0 <= value.get("confidence", -1) <= 1:
        errors.append("confidence")
    if not isinstance(value.get("dimensions"), list):
        errors.append("dimensions")
    if not isinstance(value.get("evidence"), list):
        errors.append("evidence")
    return sorted(set(errors))


def validate_analysis_output(value: Any) -> bool:
    return not validation_errors(value)
