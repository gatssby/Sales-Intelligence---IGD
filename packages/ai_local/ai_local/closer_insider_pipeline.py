from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from .closer_insider import (
    CLOSER_INSIDER_PIPELINE_VERSION,
    CLOSER_INSIDER_PLAYBOOK_VERSION,
    Turn,
    build_turns,
    hydrate_evidence,
    merge_evidence,
    normalize_commercial_outcome,
    source_metadata,
    validate_stage_references,
)
from .closer_insider_prompting import closer_prompt, commercial_prompt, critic_prompt, evidence_prompt, final_prompt
from .closer_insider_schema import CLOSER_INSIDER_SCHEMAS


class CloserInsiderProvider(Protocol):
    model: str

    def complete(self, system: str, user: str, *, schema: dict[str, Any] | None = None, max_tokens: int = 2048, temperature: float = 0.0) -> dict[str, Any]: ...


@dataclass(frozen=True)
class CloserInsiderResult:
    source: dict[str, Any]
    turns: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    commercial_state: dict[str, Any]
    closer_evaluation: dict[str, Any]
    critic: dict[str, Any]
    final: dict[str, Any]
    artifacts: dict[str, Any]
    metrics: dict[str, Any]
    provenance: dict[str, Any]


class CloserInsiderPipeline:
    def __init__(self, provider: CloserInsiderProvider, *, max_turns: int = 80, overlap_turns: int = 8):
        self.provider = provider
        self.max_turns = max_turns
        self.overlap_turns = overlap_turns

    def analyze(self, transcript: str) -> CloserInsiderResult:
        started = time.monotonic()
        if not transcript.strip():
            raise ValueError("transcript must not be empty")
        turns = build_turns(transcript)
        source = source_metadata(turns, transcript)
        turns_payload = [turn.__dict__ for turn in turns]
        empty = {"scoreability": "unscorable", "requires_human_review": True}
        if source["source_type"] != "verbatim_transcript" or len(turns) < 4:
            final = {
                "executive_summary": "A fonte não contém material suficiente para avaliar esta call como transcrição verbatim.",
                "strengths": [], "critical_failures": [], "missed_opportunities": [], "coaching_actions": [],
                "risk_or_compliance_flags": [], "primary_failure": "insufficient_source", "confidence": 0.0,
                "requires_human_review": True, "evidence_ids": [], **empty,
            }
            return self._result(transcript, source, turns_payload, [], {}, {}, {}, final, {}, started, passes=0)

        chunks = self._chunks(turns)
        evidence_passes = []
        for chunk in chunks:
            evidence_passes.append(self.provider.complete(
                evidence_prompt(),
                json.dumps({"turns": [turn.__dict__ for turn in chunk]}, ensure_ascii=False),
                schema=CLOSER_INSIDER_SCHEMAS["evidence"], max_tokens=1536,
            ))
        ledger = hydrate_evidence(merge_evidence(evidence_passes, turns), turns)
        valid_ids = {item["evidence_id"] for item in ledger}
        commercial = self.provider.complete(commercial_prompt(), json.dumps({"source": source, "evidence": ledger}, ensure_ascii=False), schema=CLOSER_INSIDER_SCHEMAS["commercial_state"], max_tokens=1024)
        validate_stage_references(commercial, valid_ids)
        commercial["outcome"] = normalize_commercial_outcome(commercial.get("outcome", "unknown"), ledger)
        closer = self.provider.complete(closer_prompt(), json.dumps({"evidence": ledger, "commercial_state": commercial}, ensure_ascii=False), schema=CLOSER_INSIDER_SCHEMAS["closer_evaluation"], max_tokens=2048)
        validate_stage_references(closer, valid_ids)
        critic = self.provider.complete(critic_prompt(), json.dumps({"evidence": ledger, "commercial_state": commercial, "closer_evaluation": closer}, ensure_ascii=False), schema=CLOSER_INSIDER_SCHEMAS["critic"], max_tokens=1536)
        validate_stage_references(critic, valid_ids)
        final = self.provider.complete(final_prompt(), json.dumps({"source": source, "evidence": ledger, "commercial_state": commercial, "closer_evaluation": closer, "critic": critic}, ensure_ascii=False), schema=CLOSER_INSIDER_SCHEMAS["final"], max_tokens=2048)
        validate_stage_references(final, valid_ids)
        final["scoreability"] = source["scoreability"]
        final["requires_human_review"] = bool(final.get("requires_human_review"))
        return self._result(transcript, source, turns_payload, ledger, commercial, closer, critic, final, {"chunks": len(chunks)}, started, passes=len(chunks) + 4)

    def _chunks(self, turns: list[Turn]) -> list[list[Turn]]:
        if self.max_turns < 1 or self.overlap_turns < 0 or self.overlap_turns >= self.max_turns:
            raise ValueError("invalid chunk configuration")
        chunks: list[list[Turn]] = []
        start = 0
        while start < len(turns):
            end = min(start + self.max_turns, len(turns))
            chunks.append(turns[start:end])
            if end == len(turns):
                break
            start = end - self.overlap_turns
        return chunks

    def _result(self, transcript: str, source: dict[str, Any], turns: list[dict[str, Any]], evidence: list[dict[str, Any]], commercial: dict[str, Any], closer: dict[str, Any], critic: dict[str, Any], final: dict[str, Any], extra_metrics: dict[str, Any], started: float, *, passes: int) -> CloserInsiderResult:
        history = getattr(self.provider, "completion_history", None)
        history = history if isinstance(history, list) else []
        metrics = {
            "passes": passes,
            "chunks": extra_metrics.get("chunks", 0),
            "latency_ms": int((time.monotonic() - started) * 1000),
            "evidence_count": len(evidence),
            "grounded_evidence_count": len(evidence),
            "grounding_rate": 1.0 if evidence else 0.0,
            "input_tokens": sum(getattr(item, "input_tokens", 0) or 0 for item in history[-passes:]) if history else None,
            "output_tokens": sum(getattr(item, "output_tokens", 0) or 0 for item in history[-passes:]) if history else None,
            "schema_valid": True,
        }
        provenance = {
            "pipeline_version": CLOSER_INSIDER_PIPELINE_VERSION,
            "schema_version": "closer-insider-eval-v1",
            "playbook_version": CLOSER_INSIDER_PLAYBOOK_VERSION,
            "model": getattr(self.provider, "model", "unknown"),
            "transcript_sha256": hashlib.sha256(transcript.encode()).hexdigest(),
            "source_type": source["source_type"],
            "passes": passes,
            "chunks": metrics["chunks"],
        }
        artifacts = {"turns": turns, "evidence": evidence, "commercial_state": commercial, "closer_evaluation": closer, "critic": critic, "final": final, "metrics": metrics}
        return CloserInsiderResult(source, turns, evidence, commercial, closer, critic, final, artifacts, metrics, provenance)
