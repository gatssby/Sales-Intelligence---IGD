#!/usr/bin/env python3
"""Deterministic metrics for local Qwen JSON outputs; no model/API calls."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def evaluate(transcript: str, result: dict[str, Any]) -> dict[str, Any]:
    evidence = result.get("evidence", []) if isinstance(result, dict) else []
    grounded = [item for item in evidence if isinstance(item, dict) and item.get("quote") and item["quote"] in transcript]
    required = {"scoreability", "overall_score", "dimensions", "evidence", "requires_human_review"}
    return {
        "json_valid": True,
        "required_keys_present": required.issubset(result),
        "evidence_count": len(evidence),
        "grounded_evidence_count": len(grounded),
        "grounding_rate": len(grounded) / len(evidence) if evidence else 1.0,
        "dimension_keys": [d.get("key") for d in result.get("dimensions", []) if isinstance(d, dict)],
        "complete": bool(result.get("executive_summary")) and bool(result.get("dimensions")),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = json.loads(args.result.read_text())
        metrics = evaluate(args.transcript.read_text(), result)
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"json_valid": False, "error": str(exc)}))
        raise SystemExit(1)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
