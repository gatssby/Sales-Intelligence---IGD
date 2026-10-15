from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from .chunking import chunk_transcript
from .schema import validate_analysis_output, validation_errors


class Provider(Protocol):
    def complete(self, system: str, user: str, **kwargs: Any) -> dict[str, Any]: ...


@dataclass(frozen=True)
class PipelineMetrics:
    passes: int
    chunks: int
    retries: int
    latency_ms: int
    grounded_evidence: int
    schema_valid: bool


@dataclass(frozen=True)
class PipelineResult:
    output: dict[str, Any]
    metrics: PipelineMetrics
    provenance: dict[str, Any]


class LocalQwenPipeline:
    def __init__(self, provider: Provider, dimensions: list[str], max_turns: int = 80, overlap_turns: int = 8, pipeline_version: str = "local-qwen-v2"):
        self.provider = provider
        self.dimensions = dimensions
        self.max_turns = max_turns
        self.overlap_turns = overlap_turns
        self.pipeline_version = pipeline_version

    def analyze(self, transcript: str) -> PipelineResult:
        started = time.monotonic()
        chunks = chunk_transcript(transcript, self.max_turns, self.overlap_turns)
        if not chunks:
            raise ValueError("transcript must contain at least one non-empty turn")
        fact_passes = [
            self.provider.complete(
                "Extract only grounded facts and evidence from this transcript chunk. Preserve exact quotes and source locations.",
                json.dumps({"chunk_index": chunk.index, "source_start": chunk.source_start, "source_end": chunk.source_end, "text": chunk.text}, ensure_ascii=False),
            )
            for chunk in chunks
        ]
        facts = {"chunks": fact_passes}
        commercial = self.provider.complete("Infer commercial state only from the facts below.", json.dumps(facts, ensure_ascii=False))
        dimensions = self.provider.complete("Evaluate the requested dimensions using only the structured facts and commercial state.", json.dumps({"facts": facts, "commercial": commercial, "dimensions": self.dimensions}, ensure_ascii=False))
        coaching = self.provider.complete("Produce strengths, critical failures, and coaching grounded in the structured assessment.", json.dumps({"facts": facts, "commercial": commercial, "dimensions": dimensions}, ensure_ascii=False))
        final = self.provider.complete("Return the final analysis object, preserving grounded evidence and every required dimension.", json.dumps({"facts": facts, "commercial": commercial, "dimensions": dimensions, "coaching": coaching}, ensure_ascii=False))
        errors = validation_errors(final)
        if errors:
            raise ValueError(f"final analysis failed schema validation: {errors}")
        grounded = sum(1 for item in final.get("evidence", []) if item.get("quote") and item["quote"] in transcript)
        metrics = PipelineMetrics(4 + len(chunks), len(chunks), 0, int((time.monotonic() - started) * 1000), grounded, validate_analysis_output(final))
        provenance = {
            "pipeline_version": self.pipeline_version,
            "model": getattr(self.provider, "model", "unknown"),
            "transcript_sha256": hashlib.sha256(transcript.encode()).hexdigest(),
            "chunk_strategy_version": f"turns-{self.max_turns}-overlap-{self.overlap_turns}",
            "chunks": len(chunks),
            "passes": metrics.passes,
        }
        return PipelineResult(final, metrics, provenance)
