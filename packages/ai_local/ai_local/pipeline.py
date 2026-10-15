from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from .chunking import chunk_transcript
from .intermediate_schema import COACHING_JSON_SCHEMA, COMMERCIAL_JSON_SCHEMA, DIMENSIONS_JSON_SCHEMA, FACTS_JSON_SCHEMA
from .schema import ANALYSIS_JSON_SCHEMA, validate_analysis_output, validation_errors


class Provider(Protocol):
    model: str

    def complete(self, system: str, user: str, *, schema: dict[str, Any] | None = None, max_tokens: int = 2048, temperature: float = 0.0) -> dict[str, Any]: ...


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
                json.dumps({"chunk_id": chunk.chunk_id, "source_start": chunk.source_start, "source_end": chunk.source_end, "text": chunk.text}, ensure_ascii=False),
                schema=FACTS_JSON_SCHEMA,
            )
            for chunk in chunks
        ]
        facts = {"chunks": fact_passes}
        commercial = self.provider.complete("Infer commercial state only from the facts below.", json.dumps(facts, ensure_ascii=False), schema=COMMERCIAL_JSON_SCHEMA)
        dimensions = self.provider.complete("Evaluate the requested dimensions using only the structured facts and commercial state.", json.dumps({"facts": facts, "commercial": commercial, "dimensions": self.dimensions}, ensure_ascii=False), schema=DIMENSIONS_JSON_SCHEMA)
        coaching = self.provider.complete("Produce strengths, critical failures, and coaching grounded in the structured assessment.", json.dumps({"facts": facts, "commercial": commercial, "dimensions": dimensions}, ensure_ascii=False), schema=COACHING_JSON_SCHEMA)
        final = self.provider.complete("Return the final analysis object, preserving grounded evidence and every required dimension.", json.dumps({"facts": facts, "commercial": commercial, "dimensions": dimensions, "coaching": coaching}, ensure_ascii=False), schema=ANALYSIS_JSON_SCHEMA)
        errors = validation_errors(final)
        if errors:
            raise ValueError(f"final analysis failed schema validation: {errors}")
        grounding: list[dict[str, Any]] = []
        seen_quotes: set[str] = set()
        for item in final.get("evidence", []):
            quote = item.get("quote", "").strip()
            matching_chunk = next((chunk for chunk in chunks if quote and quote in chunk.text), None)
            grounding.append({
                "quote": quote,
                "criterion": item.get("criterion", ""),
                "chunk_id": matching_chunk.chunk_id if matching_chunk else None,
                "source_start": matching_chunk.source_start if matching_chunk else None,
                "source_end": matching_chunk.source_end if matching_chunk else None,
                "grounded": matching_chunk is not None,
                "duplicate": quote in seen_quotes if quote else False,
            })
            if quote:
                seen_quotes.add(quote)
        grounded = sum(1 for item in grounding if item["grounded"] and not item["duplicate"])
        retry_value = getattr(self.provider, "last_retry_count", 0)
        retries = retry_value if isinstance(retry_value, int) else 0
        metrics = PipelineMetrics(4 + len(chunks), len(chunks), retries, int((time.monotonic() - started) * 1000), grounded, validate_analysis_output(final))
        provenance = {
            "pipeline_version": self.pipeline_version,
            "schema_version": "analysis-output-v2-with-intermediates-v1",
            "model": getattr(self.provider, "model", "unknown"),
            "transcript_sha256": hashlib.sha256(transcript.encode()).hexdigest(),
            "chunk_strategy_version": f"turns-{self.max_turns}-overlap-{self.overlap_turns}",
            "chunks": len(chunks),
            "passes": metrics.passes,
            "grounding": grounding,
            "grounding_rate": grounded / len(grounding) if grounding else 1.0,
        }
        return PipelineResult(final, metrics, provenance)
