#!/usr/bin/env python3
"""Compare sanitized evidence and final metrics for the two experiments."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def load(path: Path, name: str, default: Any = None) -> Any:
    candidate = path / name
    if not candidate.is_file():
        return default
    return json.loads(candidate.read_text(encoding="utf-8"))


def evidence_signature(item: dict[str, Any]) -> tuple[str, str]:
    return str(item.get("turn_id", "")), str(item.get("evidence_type", ""))


def evidence_report(reference: list[dict[str, Any]], candidate: list[dict[str, Any]]) -> dict[str, Any]:
    ref_sigs = Counter(evidence_signature(item) for item in reference)
    cand_sigs = Counter(evidence_signature(item) for item in candidate)
    intersection = sum((ref_sigs & cand_sigs).values())
    return {
        "reference_count": len(reference),
        "candidate_count": len(candidate),
        "reference_types": dict(Counter(str(x.get("evidence_type", "")) for x in reference)),
        "candidate_types": dict(Counter(str(x.get("evidence_type", "")) for x in candidate)),
        "reference_turns": len({str(x.get("turn_id", "")) for x in reference}),
        "candidate_turns": len({str(x.get("turn_id", "")) for x in candidate}),
        "signature_intersection": intersection,
        "reference_only_signature_count": sum((ref_sigs - cand_sigs).values()),
        "candidate_only_signature_count": sum((cand_sigs - ref_sigs).values()),
        "reference_only_signatures": sorted([list(k) for k in (ref_sigs - cand_sigs).keys()]),
        "candidate_only_signatures": sorted([list(k) for k in (cand_sigs - ref_sigs).keys()]),
        "reference_timestamp_coverage": sum(bool(x.get("timestamp")) for x in reference),
        "candidate_timestamp_coverage": sum(bool(x.get("timestamp")) for x in candidate),
    }


def final_report(ref: dict[str, Any], cand: dict[str, Any]) -> dict[str, Any]:
    list_fields = ["strengths", "critical_failures", "missed_opportunities", "coaching_actions", "risk_or_compliance_flags"]
    commercial_fields = ["current_opportunity_fit", "future_requalification_potential", "urgency", "authority", "budget_or_capacity", "decision_process", "availability", "outcome"]
    return {
        "reference": {field: len(ref.get(field, [])) for field in list_fields} | {field: ref.get(field) for field in commercial_fields},
        "candidate": {field: len(cand.get(field, [])) for field in list_fields} | {field: cand.get(field) for field in commercial_fields},
        "primary_failure_changed": ref.get("primary_failure") != cand.get("primary_failure"),
        "confidence": {"reference": ref.get("confidence"), "candidate": cand.get("confidence")},
        "human_review": {"reference": ref.get("requires_human_review"), "candidate": cand.get("requires_human_review")},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--reference-regression", type=Path, required=True)
    parser.add_argument("--candidate-regression", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    ref_evidence = load(args.reference, "evidence.json", [])
    cand_evidence = load(args.candidate, "evidence.json", [])
    ref_metrics = load(args.reference, "metrics.json", {})
    cand_metrics = load(args.candidate, "metrics.json", {})
    ref_reg = json.loads(args.reference_regression.read_text(encoding="utf-8"))
    cand_reg = json.loads(args.candidate_regression.read_text(encoding="utf-8"))
    result = {
        "comparison": "9b-only-vs-4b-evidence-9b-downstream",
        "evidence": evidence_report(ref_evidence, cand_evidence),
        "grounding": {
            "reference": {key: ref_reg.get(key) for key in ["valid", "evidence_count", "quote_mismatches", "invalid_turn_ids", "turn_count", "chunk_count"]},
            "candidate": {key: cand_reg.get(key) for key in ["valid", "evidence_count", "quote_mismatches", "invalid_turn_ids", "turn_count", "chunk_count"]},
        },
        "performance": {
            "reference": {key: ref_metrics.get(key) for key in ["latency_ms", "input_tokens", "output_tokens", "stage_metrics"]},
            "candidate": {key: cand_metrics.get(key) for key in ["latency_ms", "input_tokens", "output_tokens", "stage_metrics"]},
        },
        "commercial_and_final": final_report(load(args.reference, "final.json", {}), load(args.candidate, "final.json", {})),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
