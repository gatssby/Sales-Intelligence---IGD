#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _analysis(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        return {}
    output = value.get("output")
    return output if isinstance(output, dict) else value


def _quotes(analysis: dict[str, Any]) -> set[str]:
    return {item.get("quote", "").strip() for item in analysis.get("evidence", []) if isinstance(item, dict) and item.get("quote", "").strip()}


def compare_record(qwen: dict[str, Any], historical: list[dict[str, Any]], transcript: str) -> dict[str, Any]:
    q_analysis = _analysis(qwen)
    refs = [(_analysis(item.get("result_json", {})), item) for item in historical]
    q_quotes = _quotes(q_analysis)
    grounded = {quote for quote in q_quotes if quote in transcript}
    historical_quotes = set().union(*(_quotes(analysis) for analysis, _ in refs)) if refs else set()
    score_values = sorted({float(analysis["overall_score"]) for analysis, _ in refs if isinstance(analysis.get("overall_score"), (int, float))})
    outcomes = sorted({str(analysis["call_outcome"]) for analysis, _ in refs if analysis.get("call_outcome")})
    q_outcome = q_analysis.get("call_outcome")
    q_score = q_analysis.get("overall_score")
    q_dimensions = {item.get("key") for item in q_analysis.get("dimensions", []) if isinstance(item, dict) and item.get("key")}
    ref_dimensions = set().union(*({str(item["key"]) for item in analysis.get("dimensions", []) if isinstance(item, dict) and item.get("key")} for analysis, _ in refs)) if refs else set()
    return {
        "call_id": qwen.get("call_id"),
        "strategy": qwen.get("provenance", {}).get("strategy"),
        "pipeline_version": qwen.get("provenance", {}).get("pipeline_version"),
        "prompt_version": qwen.get("provenance", {}).get("prompt_version"),
        "rubric_version": qwen.get("provenance", {}).get("rubric_version"),
        "historical_models": sorted({item.get("model") for _, item in refs if item.get("model")}),
        "historical_runs": len(refs),
        "historical_score_values": score_values,
        "qwen_score": q_score,
        "score_delta_to_historical_min": q_score - min(score_values) if score_values and isinstance(q_score, (int, float)) else None,
        "historical_outcomes": outcomes,
        "qwen_outcome": q_outcome,
        "outcome_agreement": q_outcome in outcomes if outcomes else None,
        "qwen_dimension_keys": sorted(str(key) for key in q_dimensions),
        "historical_dimension_keys": sorted(ref_dimensions),
        "qwen_dimension_coverage_vs_rubric": len(q_dimensions & ref_dimensions) / len(ref_dimensions) if ref_dimensions else 0.0,
        "qwen_evidence_count": len(q_quotes),
        "qwen_grounded_evidence_count": len(grounded),
        "qwen_grounding_rate": len(grounded) / len(q_quotes) if q_quotes else 1.0,
        "qwen_evidence_overlap_count": len(q_quotes & historical_quotes),
        "historical_evidence_quote_count": len(historical_quotes),
        "historical_consensus": len(outcomes) <= 1 and len(score_values) <= 1,
        "metrics": qwen.get("metrics", {}),
    }


def markdown_report(result: dict[str, Any]) -> str:
    lines = [f"# Qwen historical comparison — {result.get('call_id')}", "", "| Campo | Valor |", "|---|---|"]
    for key, value in result.items():
        lines.append(f"| {key} | {json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value} |")
    lines.extend(["", "Interpretação:", "- A análise histórica é referência, não golden truth.", "- Grounding é medido contra a transcrição local; overlap histórico mede apenas coincidência literal de quotes."])
    if not result["historical_consensus"]:
        lines.append("- Há divergência entre referências históricas; não penalizar automaticamente o Qwen.")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    records = []
    for bucket in ("short", "medium", "long"):
        directory = args.root / bucket
        qwen_path = directory / "qwen.json"
        if not qwen_path.exists():
            continue
        qwen = json.loads(qwen_path.read_text(encoding="utf-8"))
        historical = json.loads((directory / "historical.json").read_text(encoding="utf-8"))
        transcript = (directory / "transcript.txt").read_text(encoding="utf-8")
        result = compare_record(qwen, historical, transcript)
        result["bucket"] = bucket
        records.append(result)
        (args.out / bucket).mkdir(parents=True, exist_ok=True)
        (args.out / bucket / "comparison.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        (args.out / bucket / "comparison.md").write_text(markdown_report(result), encoding="utf-8")
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"calls": len(records), "out": str(args.out)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
