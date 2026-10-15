from __future__ import annotations

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


class LocalQwenPipeline:
    def __init__(self, provider: Provider, dimensions: list[str], max_turns: int = 80, overlap_turns: int = 8):
        self.provider = provider
        self.dimensions = dimensions
        self.max_turns = max_turns
        self.overlap_turns = overlap_turns

    def analyze(self, transcript: str) -> PipelineResult:
        started = time.monotonic()
        chunks = chunk_transcript(transcript, self.max_turns, self.overlap_turns)
        fact_passes = [
            self.provider.complete("Extract only grounded facts and evidence from this transcript chunk. Preserve exact quotes and source locations.", chunk.text)
            for chunk in chunks
        ]
        facts = {"chunks": fact_passes}
        commercial = self.provider.complete("Infer commercial state only from the facts below.", str(facts))
        dimensions = self.provider.complete("Evaluate the requested dimensions using only the structured facts and commercial state.", str({"facts": facts, "commercial": commercial, "dimensions": self.dimensions}))
        coaching = self.provider.complete("Produce strengths, critical failures, and coaching grounded in the structured assessment.", str({"facts": facts, "commercial": commercial, "dimensions": dimensions}))
        final = self.provider.complete("Return the final analysis object, preserving grounded evidence and every required dimension.", str({"facts": facts, "commercial": commercial, "dimensions": dimensions, "coaching": coaching}))
        errors = validation_errors(final)
        if errors:
            raise ValueError(f"final analysis failed schema validation: {errors}")
        grounded = sum(1 for item in final.get("evidence", []) if item.get("quote") and item["quote"] in transcript)
        metrics = PipelineMetrics(4 + len(chunks), len(chunks), 0, int((time.monotonic() - started) * 1000), grounded, validate_analysis_output(final))
        return PipelineResult(final, metrics)
