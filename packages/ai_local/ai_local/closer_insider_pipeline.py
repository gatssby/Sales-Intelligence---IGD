from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
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
    def __init__(self, provider: CloserInsiderProvider, *, max_turns: int = 80, overlap_turns: int = 8, checkpoint_dir: str | Path | None = None):
        self.provider = provider
        self.max_turns = max_turns
        self.overlap_turns = overlap_turns
        self.checkpoint_dir = Path(checkpoint_dir) if checkpoint_dir else None

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
        chunk_artifacts = []
        global_payloads = {}
        stage_metrics = {}
        checkpoint_fingerprint = self._checkpoint_fingerprint(transcript)
        if self.checkpoint_dir:
            (self.checkpoint_dir / "chunks").mkdir(parents=True, exist_ok=True)
        for index, chunk in enumerate(chunks, start=1):
            chunk_payload = {"turns": [turn.__dict__ for turn in chunk]}
            chunk_id = f"chunk-{index:04d}"
            checkpoint_path = self.checkpoint_dir / "chunks" / f"{chunk_id}-evidence.json" if self.checkpoint_dir else None
            evidence_output = self._load_checkpoint(checkpoint_path, checkpoint_fingerprint, chunk)
            reused = evidence_output is not None
            if evidence_output is None:
                evidence_output = self._complete_stage(
                    f"evidence_chunk_{index:04d}", evidence_prompt(), chunk_payload,
                    schema=CLOSER_INSIDER_SCHEMAS["evidence"], max_tokens=3072,
                )
                self._validate_chunk_output(evidence_output, chunk)
                self._save_checkpoint(checkpoint_path, checkpoint_fingerprint, chunk_id, chunk, evidence_output)
            stage_metrics[chunk_id] = {
                "reused_checkpoint": reused,
                **(self._provider_metrics() if not reused else {"input_tokens": None, "output_tokens": None, "finish_reason": "checkpoint", "retries": 0}),
            }
            evidence_passes.append(evidence_output)
            chunk_artifacts.append({
                "chunk_id": chunk_id,
                "turn_ids": [turn.turn_id for turn in chunk],
                "source_start": chunk[0].source_index,
                "source_end": chunk[-1].source_index + 1,
                "evidence": evidence_output.get("evidence", []),
            })
        ledger = hydrate_evidence(merge_evidence(evidence_passes, turns), turns)
        valid_ids = {item["evidence_id"] for item in ledger}
        commercial_payload = {"source": source, "evidence": ledger}
        global_payloads["commercial"] = self._payload_stats(commercial_payload)
        commercial = self._complete_stage("commercial", commercial_prompt(), commercial_payload, schema=CLOSER_INSIDER_SCHEMAS["commercial_state"], max_tokens=1024)
        stage_metrics["commercial"] = self._provider_metrics()
        validate_stage_references(commercial, valid_ids)
        commercial["outcome"] = normalize_commercial_outcome(commercial.get("outcome", "unknown"), ledger)
        closer_payload = {"evidence": ledger, "commercial_state": commercial}
        global_payloads["closer_evaluation"] = self._payload_stats(closer_payload)
        closer = self._complete_stage("closer_evaluation", closer_prompt(), closer_payload, schema=CLOSER_INSIDER_SCHEMAS["closer_evaluation"], max_tokens=3072)
        stage_metrics["closer_evaluation"] = self._provider_metrics()
        validate_stage_references(closer, valid_ids)
        critic_payload = {"evidence": ledger, "commercial_state": commercial, "closer_evaluation": closer}
        global_payloads["critic"] = self._payload_stats(critic_payload)
        critic = self._complete_stage("critic", critic_prompt(), critic_payload, schema=CLOSER_INSIDER_SCHEMAS["critic"], max_tokens=1536)
        stage_metrics["critic"] = self._provider_metrics()
        validate_stage_references(critic, valid_ids)
        final_payload = {"source": source, "evidence": ledger, "commercial_state": commercial, "closer_evaluation": closer, "critic": critic}
        global_payloads["final"] = self._payload_stats(final_payload)
        final = self._complete_stage("final", final_prompt(), final_payload, schema=CLOSER_INSIDER_SCHEMAS["final"], max_tokens=3072)
        stage_metrics["final"] = self._provider_metrics()
        validate_stage_references(final, valid_ids)
        final["scoreability"] = source["scoreability"]
        final["requires_human_review"] = bool(final.get("requires_human_review"))
        raw_evidence_count = sum(len(output.get("evidence", [])) for output in evidence_passes)
        return self._result(transcript, source, turns_payload, ledger, commercial, closer, critic, final, {
            "chunks": len(chunks),
            "chunk_artifacts": chunk_artifacts,
            "global_payloads": global_payloads,
            "raw_evidence_count": raw_evidence_count,
            "duplicates_removed": raw_evidence_count - len(ledger),
            "stage_metrics": stage_metrics,
        }, started, passes=len(chunks) + 4)

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

    @staticmethod
    def _payload_stats(payload: dict[str, Any]) -> dict[str, int]:
        characters = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return {"characters": characters, "estimated_tokens": math.ceil(characters / 4)}

    def _provider_metrics(self) -> dict[str, Any]:
        metrics = getattr(self.provider, "last_metrics", None)
        return {
            "input_tokens": getattr(metrics, "input_tokens", None),
            "output_tokens": getattr(metrics, "output_tokens", None),
            "finish_reason": getattr(metrics, "finish_reason", None),
            "retries": getattr(self.provider, "last_retry_count", 0),
        }

    def _checkpoint_fingerprint(self, transcript: str) -> str:
        payload = {
            "transcript_sha256": hashlib.sha256(transcript.encode()).hexdigest(),
            "max_turns": self.max_turns,
            "overlap_turns": self.overlap_turns,
            "pipeline_version": CLOSER_INSIDER_PIPELINE_VERSION,
            "playbook_version": CLOSER_INSIDER_PLAYBOOK_VERSION,
            "evidence_prompt_sha256": hashlib.sha256(evidence_prompt().encode()).hexdigest(),
            "evidence_schema_sha256": hashlib.sha256(json.dumps(CLOSER_INSIDER_SCHEMAS["evidence"], sort_keys=True).encode()).hexdigest(),
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    @staticmethod
    def _validate_chunk_output(output: dict[str, Any], chunk: list[Turn]) -> None:
        if not isinstance(output, dict) or not isinstance(output.get("evidence"), list):
            raise ValueError("evidence extraction output must contain an evidence list")
        valid_turn_ids = {turn.turn_id for turn in chunk}
        for item in output["evidence"]:
            if not isinstance(item, dict) or item.get("turn_id") not in valid_turn_ids:
                raise ValueError("evidence extraction returned an invalid turn_id")

    @classmethod
    def _load_checkpoint(cls, path: Path | None, fingerprint: str, chunk: list[Turn]) -> dict[str, Any] | None:
        if path is None or not path.is_file():
            return None
        try:
            checkpoint = json.loads(path.read_text(encoding="utf-8"))
            if checkpoint.get("fingerprint") != fingerprint or checkpoint.get("turn_ids") != [turn.turn_id for turn in chunk]:
                return None
            output = {"evidence": checkpoint.get("evidence", [])}
            cls._validate_chunk_output(output, chunk)
            return output
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            return None

    @staticmethod
    def _save_checkpoint(path: Path | None, fingerprint: str, chunk_id: str, chunk: list[Turn], output: dict[str, Any]) -> None:
        if path is None:
            return
        payload = {
            "checkpoint_version": 1,
            "fingerprint": fingerprint,
            "chunk_id": chunk_id,
            "turn_ids": [turn.turn_id for turn in chunk],
            "source_start": chunk[0].source_index,
            "source_end": chunk[-1].source_index + 1,
            "evidence": output["evidence"],
        }
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)

    def _complete_stage(self, stage: str, system: str, payload: dict[str, Any], *, schema: dict[str, Any], max_tokens: int) -> dict[str, Any]:
        user = json.dumps(payload, ensure_ascii=False)
        try:
            return self.provider.complete(system, user, schema=schema, max_tokens=max_tokens)
        except Exception as exc:
            stats = self._payload_stats(payload)
            raise RuntimeError(
                f"closer_insider stage={stage} payload_chars={stats['characters']} estimated_tokens={stats['estimated_tokens']}"
            ) from exc

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
            "raw_evidence_count": extra_metrics.get("raw_evidence_count", len(evidence)),
            "duplicates_removed": extra_metrics.get("duplicates_removed", 0),
            "invalid_evidence_ids": 0,
            "quote_mismatches": 0,
            "evidence_with_timestamp": sum(1 for item in evidence if item.get("timestamp")),
            "global_payloads": extra_metrics.get("global_payloads", {}),
            "stage_metrics": extra_metrics.get("stage_metrics", {}),
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
        artifacts = {"turns": turns, "evidence": evidence, "commercial_state": commercial, "closer_evaluation": closer, "critic": critic, "final": final, "metrics": metrics, "chunks": extra_metrics.get("chunk_artifacts", [])}
        return CloserInsiderResult(source, turns, evidence, commercial, closer, critic, final, artifacts, metrics, provenance)
