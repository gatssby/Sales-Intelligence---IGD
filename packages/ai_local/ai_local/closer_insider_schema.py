from __future__ import annotations

from typing import Any

CLOSER_INSIDER_SCHEMA_VERSION = "closer-insider-eval-v1"


def obj(required: list[str], properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "required": required, "properties": properties}

STRING = {"type": "string"}
STRING_ARRAY = {"type": "array", "items": STRING}
EVIDENCE_IDS = {"type": "array", "items": STRING}
CONFIDENCE = {"type": "number", "minimum": 0, "maximum": 1}

SOURCE_SCHEMA = obj(["source_type", "source_quality", "scoreability", "requires_human_review"], {
    "source_type": {"type": "string", "enum": ["verbatim_transcript", "partial_transcript", "meeting_notes", "unknown"]},
    "source_quality": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
    "scoreability": {"type": "string", "enum": ["scoreable", "unscorable"]},
    "requires_human_review": {"type": "boolean"},
})

COMMERCIAL_STATE_SCHEMA = obj([
    "current_opportunity_fit", "future_requalification_potential", "requalification_conditions", "qualification_gaps", "urgency", "authority", "budget_or_capacity", "decision_process", "availability", "outcome", "next_step", "evidence_ids"
], {
    "current_opportunity_fit": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
    "future_requalification_potential": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
    "requalification_conditions": STRING_ARRAY,
    "qualification_gaps": STRING_ARRAY,
    "urgency": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
    "authority": {"type": "string", "enum": ["confirmed", "partial", "unknown"]},
    "budget_or_capacity": {"type": "string", "enum": ["confirmed", "partial", "insufficient", "unknown"]},
    "decision_process": {"type": "string", "enum": ["clear", "partial", "unknown"]},
    "availability": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
    "outcome": {"type": "string", "enum": ["sold", "not_sold", "follow_up", "disqualified", "unknown"]},
    "next_step": STRING,
    "evidence_ids": EVIDENCE_IDS,
})

CLOSER_AREA_SCHEMA = obj(["assessment", "positive_evidence_ids", "negative_evidence_ids", "missing_or_missed_behaviors", "rationale", "confidence"], {
    "assessment": {"type": "string", "enum": ["strong", "adequate", "weak", "unknown"]},
    "positive_evidence_ids": EVIDENCE_IDS,
    "negative_evidence_ids": EVIDENCE_IDS,
    "missing_or_missed_behaviors": STRING_ARRAY,
    "rationale": STRING,
    "confidence": CONFIDENCE,
})

CLOSER_EVALUATION_SCHEMA = obj([
    "opening_and_expectation", "discovery", "diagnosis", "qualification", "pitch_and_value_connection", "objection_handling", "closing_and_next_step", "professionalism", "conversation_control"
], {key: CLOSER_AREA_SCHEMA for key in [
    "opening_and_expectation", "discovery", "diagnosis", "qualification", "pitch_and_value_connection", "objection_handling", "closing_and_next_step", "professionalism", "conversation_control"
]})

CRITIC_SCHEMA = obj(["critic_findings", "evidence_ids"], {
    "critic_findings": {"type": "array", "items": obj(["finding", "evidence_ids", "absence_basis", "severity"], {
        "finding": STRING, "evidence_ids": EVIDENCE_IDS, "absence_basis": STRING,
        "severity": {"type": "string", "enum": ["material", "moderate", "minor"]},
    })},
    "evidence_ids": EVIDENCE_IDS,
})

FINAL_SCHEMA = obj([
    "executive_summary", "strengths", "critical_failures", "missed_opportunities", "coaching_actions", "risk_or_compliance_flags", "primary_failure", "confidence", "requires_human_review", "evidence_ids"
], {
    "executive_summary": STRING,
    "strengths": STRING_ARRAY,
    "critical_failures": STRING_ARRAY,
    "missed_opportunities": STRING_ARRAY,
    "coaching_actions": STRING_ARRAY,
    "risk_or_compliance_flags": STRING_ARRAY,
    "primary_failure": STRING,
    "confidence": CONFIDENCE,
    "requires_human_review": {"type": "boolean"},
    "evidence_ids": EVIDENCE_IDS,
})

EVIDENCE_EXTRACTION_SCHEMA = obj(["evidence"], {
    "evidence": {"type": "array", "items": obj(["evidence_id", "turn_id", "claim", "evidence_type"], {
        "evidence_id": STRING,
        "turn_id": STRING,
        "claim": STRING,
        "evidence_type": {"type": "string", "enum": ["fact", "pain", "goal", "constraint", "objection", "commitment", "decision", "offer", "handoff", "other"]},
    })}
})

CLOSER_INSIDER_SCHEMAS = {
    "evidence": EVIDENCE_EXTRACTION_SCHEMA,
    "commercial_state": COMMERCIAL_STATE_SCHEMA,
    "closer_evaluation": CLOSER_EVALUATION_SCHEMA,
    "critic": CRITIC_SCHEMA,
    "final": FINAL_SCHEMA,
}
