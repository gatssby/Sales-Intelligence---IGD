#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ai_local.closer_insider import build_turns, normalize_commercial_outcome, validate_stage_references
from ai_local.closer_insider_pipeline import CloserInsiderPipeline


REQUIRED_FILES = (
    "turns.json",
    "evidence.json",
    "commercial_state.json",
    "closer_evaluation.json",
    "critic.json",
    "final.json",
    "metrics.json",
    "source.json",
    "run.json",
)


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _checkpoint_report(transcript: str, artifact_dir: Path, *, max_turns: int = 80, overlap_turns: int = 8) -> dict[str, Any]:
    turns = build_turns(transcript)
    pipeline = CloserInsiderPipeline(object(), max_turns=max_turns, overlap_turns=overlap_turns)
    expected_chunks = pipeline._chunks(turns)
    expected_fingerprint = pipeline._checkpoint_fingerprint(transcript)
    checkpoint_dir = artifact_dir / "chunks"
    valid = True
    files = []
    for index, chunk in enumerate(expected_chunks, start=1):
        path = checkpoint_dir / f"chunk-{index:04d}-evidence.json"
        item = {"chunk_id": f"chunk-{index:04d}", "present": path.is_file(), "compatible": False}
        if path.is_file():
            try:
                checkpoint = _load(path)
                item["compatible"] = (
                    checkpoint.get("chunk_id") == item["chunk_id"]
                    and checkpoint.get("turn_ids") == [turn.turn_id for turn in chunk]
                    and checkpoint.get("fingerprint") == expected_fingerprint
                )
            except (OSError, json.JSONDecodeError, TypeError):
                item["compatible"] = False
        valid = valid and item["present"] and item["compatible"]
        files.append(item)
    return {"expected_chunks": len(expected_chunks), "valid": valid, "files": files}


def validate_run(transcript: str, artifact_dir: Path, *, max_turns: int = 80, overlap_turns: int = 8) -> dict[str, Any]:
    errors: list[str] = []
    missing = [name for name in REQUIRED_FILES if not (artifact_dir / name).is_file()]
    if missing:
        return {"valid": False, "errors": [f"missing artifacts: {', '.join(missing)}"], "missing_artifacts": missing}

    turns = _load(artifact_dir / "turns.json")
    evidence = _load(artifact_dir / "evidence.json")
    commercial = _load(artifact_dir / "commercial_state.json")
    closer = _load(artifact_dir / "closer_evaluation.json")
    critic = _load(artifact_dir / "critic.json")
    final = _load(artifact_dir / "final.json")
    metrics = _load(artifact_dir / "metrics.json")
    source = _load(artifact_dir / "source.json")
    run = _load(artifact_dir / "run.json")

    turn_map = {item.get("turn_id"): item for item in turns if isinstance(item, dict)}
    valid_turn_ids = set(turn_map)
    valid_evidence_ids = {item.get("evidence_id") for item in evidence if isinstance(item, dict)}
    expected_evidence_ids = {f"E{index:06d}" for index in range(1, len(evidence) + 1)}
    if valid_evidence_ids != expected_evidence_ids:
        errors.append("evidence IDs are not sequential or unique")

    quote_mismatches = 0
    invalid_turn_ids = 0
    evidence_with_timestamp = 0
    for item in evidence:
        turn_id = item.get("turn_id")
        turn = turn_map.get(turn_id)
        if turn is None:
            invalid_turn_ids += 1
            continue
        if item.get("quote") != turn.get("text"):
            quote_mismatches += 1
        if item.get("timestamp"):
            evidence_with_timestamp += 1
    if invalid_turn_ids:
        errors.append(f"invalid evidence turn IDs: {invalid_turn_ids}")
    if quote_mismatches:
        errors.append(f"quote mismatches: {quote_mismatches}")

    for name, value in (("commercial_state", commercial), ("closer_evaluation", closer), ("critic", critic), ("final", final)):
        try:
            validate_stage_references(value, valid_evidence_ids)
        except ValueError as exc:
            errors.append(f"{name}: {exc}")

    normalized_outcome = normalize_commercial_outcome(commercial.get("outcome", "unknown"), evidence)
    if normalized_outcome != commercial.get("outcome"):
        errors.append("commercial outcome violates evidence invariant")
    if final.get("evidence_ids") and not set(final["evidence_ids"]).issubset(valid_evidence_ids):
        errors.append("final references evidence outside immutable ledger")

    checkpoint = _checkpoint_report(transcript, artifact_dir, max_turns=max_turns, overlap_turns=overlap_turns)
    if not checkpoint["valid"]:
        errors.append("checkpoint set is incomplete or incompatible")

    stage_metrics = metrics.get("stage_metrics", {})
    return {
        "valid": not errors,
        "errors": errors,
        "turn_count": len(turns),
        "chunk_count": metrics.get("chunks"),
        "evidence_count": len(evidence),
        "raw_evidence_count": metrics.get("raw_evidence_count"),
        "duplicates_removed": metrics.get("duplicates_removed"),
        "invalid_evidence_ids": metrics.get("invalid_evidence_ids", 0),
        "invalid_turn_ids": invalid_turn_ids,
        "quote_mismatches": quote_mismatches,
        "evidence_with_timestamp": evidence_with_timestamp,
        "schema_valid": bool(metrics.get("schema_valid")),
        "source": source,
        "current_opportunity_fit": commercial.get("current_opportunity_fit"),
        "future_requalification_potential": commercial.get("future_requalification_potential"),
        "qualification_gaps": commercial.get("qualification_gaps"),
        "outcome": commercial.get("outcome"),
        "requires_human_review": final.get("requires_human_review"),
        "global_payloads": metrics.get("global_payloads", {}),
        "stage_metrics": stage_metrics,
        "wall_time_ms": metrics.get("latency_ms"),
        "checkpoint": checkpoint,
        "provenance": run.get("provenance", {}),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate closer_insider_v1 artifacts deterministically")
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--max-turns", type=int, default=80)
    parser.add_argument("--overlap-turns", type=int, default=8)
    args = parser.parse_args()
    report = validate_run(args.transcript.read_text(encoding="utf-8"), args.artifact_dir, max_turns=args.max_turns, overlap_turns=args.overlap_turns)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
