#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from ai_local.schema import validate_analysis_output

DEFAULT_DIMENSIONS = ["opening_rapport", "discovery", "qualification", "diagnosis", "value_presentation", "objection_handling", "closing_next_steps"]


def evaluate_record(transcript: str, result: dict[str, Any], *, finish_reason: str | None = None, usage: dict[str, Any] | None = None, metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    analysis = result.get("output", result)
    evidence = analysis.get("evidence", []) if isinstance(analysis, dict) else []
    quotes = [item.get("quote", "").strip() for item in evidence if isinstance(item, dict)]
    grounded = [quote for quote in quotes if quote and quote in transcript]
    dimensions = [item.get("key") for item in analysis.get("dimensions", []) if isinstance(item, dict)]
    missing = [key for key in DEFAULT_DIMENSIONS if key not in dimensions]
    empty_fields = [key for key in ("executive_summary", "strengths", "critical_failures", "coaching_actions", "dimensions", "evidence") if not analysis.get(key)]
    scoreable = analysis.get("scoreability") == "scoreable"
    score_consistent = (scoreable and isinstance(analysis.get("overall_score"), (int, float))) or (not scoreable and analysis.get("overall_score") is None)
    usage_data = usage or result.get("usage") or {}
    metrics_data = metrics or result.get("metrics") or {}
    finish = finish_reason or result.get("finish_reason") or metrics_data.get("finish_reason") or "unknown"
    return {
        "json_valid": True,
        "schema_valid": validate_analysis_output(analysis),
        "finish_reason": finish,
        "truncated": finish == "length",
        "dimension_coverage": len(set(dimensions) & set(DEFAULT_DIMENSIONS)) / len(DEFAULT_DIMENSIONS),
        "missing_dimensions": ",".join(missing),
        "evidence_count": len(evidence),
        "grounded_evidence_count": len(grounded),
        "grounding_rate": len(grounded) / len(quotes) if quotes else 1.0,
        "duplicate_quote_count": len(quotes) - len(set(q for q in quotes if q)),
        "empty_field_count": len(empty_fields),
        "score_consistent": score_consistent,
        "input_tokens": usage_data.get("prompt_tokens", metrics_data.get("input_tokens")),
        "output_tokens": usage_data.get("completion_tokens", metrics_data.get("output_tokens")),
        "prompt_tokens_per_second": metrics_data.get("prompt_tokens_per_second"),
        "generation_tokens_per_second": metrics_data.get("generation_tokens_per_second"),
        "wall_time_ms": metrics_data.get("latency_ms"),
        "passes": metrics_data.get("passes"),
        "chunks": metrics_data.get("chunks"),
        "retries": metrics_data.get("retries"),
    }


def write_outputs(metric: dict[str, Any], jsonl: Path | None, csv_path: Path | None, markdown: Path | None) -> None:
    if jsonl:
        jsonl.parent.mkdir(parents=True, exist_ok=True)
        jsonl.write_text(json.dumps(metric, ensure_ascii=False) + "\n", encoding="utf-8")
    if csv_path:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(metric))
            writer.writeheader()
            writer.writerow(metric)
    if markdown:
        markdown.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# Local Qwen benchmark metrics", "", "| Metric | Value |", "|---|---:|"]
        lines.extend(f"| {key} | {value} |" for key, value in metric.items())
        markdown.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--jsonl", type=Path)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--markdown", type=Path)
    args = parser.parse_args()
    try:
        payload = json.loads(args.result.read_text(encoding="utf-8"))
        metric = evaluate_record(args.transcript.read_text(encoding="utf-8"), payload)
    except (OSError, json.JSONDecodeError) as exc:
        metric = {"json_valid": False, "error": str(exc)}
        print(json.dumps(metric, ensure_ascii=False))
        return 1
    write_outputs(metric, args.jsonl, args.csv, args.markdown)
    print(json.dumps(metric, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
