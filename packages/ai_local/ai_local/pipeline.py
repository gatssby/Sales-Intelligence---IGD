from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from .chunking import chunk_transcript
from .intermediate_schema import COACHING_JSON_SCHEMA, COMMERCIAL_JSON_SCHEMA, DIMENSIONS_JSON_SCHEMA, FACTS_JSON_SCHEMA
from .prompting import HistoricalContext, commercial_system_prompt, direct_system_prompt, dimensions_system_prompt, factual_system_prompt, final_system_prompt, coaching_system_prompt, load_historical_context
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
    input_tokens: int | None = None
    output_tokens: int | None = None
    prompt_tokens_per_second: float | None = None
    generation_tokens_per_second: float | None = None
    finish_reason: str | None = None
    truncated: bool = False


@dataclass(frozen=True)
class PipelineResult:
    output: dict[str, Any]
    metrics: PipelineMetrics
    provenance: dict[str, Any]


class LocalQwenPipeline:
    def __init__(self, provider: Provider, dimensions: list[str], max_turns: int = 80, overlap_turns: int = 8, pipeline_version: str = "local-qwen-v3-historical", strategy: str = "multipass", context: HistoricalContext | None = None):
        if strategy not in {"direct", "two_pass", "multipass"}:
            raise ValueError("strategy must be direct, two_pass or multipass")
        self.provider = provider
        self.dimensions = dimensions
        self.max_turns = max_turns
        self.overlap_turns = overlap_turns
        self.pipeline_version = pipeline_version
        self.strategy = strategy
        self.context = context or load_historical_context()

    def analyze(self, transcript: str) -> PipelineResult:
        started = time.monotonic()
        history = getattr(self.provider, "completion_history", None)
        history_start = len(history) if isinstance(history, list) else 0
        chunks = chunk_transcript(transcript, self.max_turns, self.overlap_turns)
        if not chunks:
            raise ValueError("transcript must contain at least one non-empty turn")
        if self.strategy == "direct":
            final = self.provider.complete(
                direct_system_prompt(self.context),
                transcript,
                schema=ANALYSIS_JSON_SCHEMA,
                max_tokens=2048,
            )
            return self._finish(final, transcript, chunks, started, passes=1, history_start=history_start)
        fact_passes = [
            self.provider.complete(
                factual_system_prompt(self.context),
                json.dumps({"chunk_id": chunk.chunk_id, "source_start": chunk.source_start, "source_end": chunk.source_end, "text": chunk.text}, ensure_ascii=False),
                schema=FACTS_JSON_SCHEMA,
                max_tokens=1536,
            )
            for chunk in chunks
        ]
        facts = {"chunks": fact_passes}
        if self.strategy == "two_pass":
            final = self.provider.complete(
                final_system_prompt(self.context),
                json.dumps({"facts": facts, "dimensions": self.dimensions}, ensure_ascii=False),
                schema=ANALYSIS_JSON_SCHEMA,
                max_tokens=2048,
            )
            return self._finish(final, transcript, chunks, started, passes=1 + len(chunks), history_start=history_start)
        commercial = self.provider.complete(commercial_system_prompt(self.context), json.dumps(facts, ensure_ascii=False), schema=COMMERCIAL_JSON_SCHEMA, max_tokens=384)
        dimensions = self.provider.complete(dimensions_system_prompt(self.context), json.dumps({"facts": facts, "commercial": commercial, "dimensions": self.dimensions}, ensure_ascii=False), schema=DIMENSIONS_JSON_SCHEMA, max_tokens=1536)
        coaching = self.provider.complete(coaching_system_prompt(self.context), json.dumps({"facts": facts, "commercial": commercial, "dimensions": dimensions}, ensure_ascii=False), schema=COACHING_JSON_SCHEMA, max_tokens=512)
        final = self.provider.complete(final_system_prompt(self.context), json.dumps({"facts": facts, "commercial": commercial, "dimensions": dimensions, "coaching": coaching}, ensure_ascii=False), schema=ANALYSIS_JSON_SCHEMA, max_tokens=1536)
        return self._finish(final, transcript, chunks, started, passes=4 + len(chunks), history_start=history_start)

    def _finish(self, final: dict[str, Any], transcript: str, chunks: list[Any], started: float, *, passes: int, history_start: int) -> PipelineResult:
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
        completion_history = getattr(self.provider, "completion_history", None)
        if isinstance(completion_history, list) and completion_history[history_start:]:
            completion_metrics_list = completion_history[history_start:]
        else:
            last = getattr(self.provider, "last_metrics", None)
            completion_metrics_list = [last] if isinstance(getattr(last, "input_tokens", None), int) else []
        completion_metrics = completion_metrics_list[-1] if completion_metrics_list else None
        input_tokens = sum(item.input_tokens or 0 for item in completion_metrics_list) if completion_metrics_list else None
        output_tokens = sum(item.output_tokens or 0 for item in completion_metrics_list) if completion_metrics_list else None
        prompt_seconds = sum((item.input_tokens or 0) / item.prompt_tokens_per_second for item in completion_metrics_list if item.input_tokens and item.prompt_tokens_per_second)
        generation_seconds = sum((item.output_tokens or 0) / item.generation_tokens_per_second for item in completion_metrics_list if item.output_tokens and item.generation_tokens_per_second)
        finish_reason = getattr(completion_metrics, "finish_reason", None)
        metrics = PipelineMetrics(
            passes, len(chunks), retries, int((time.monotonic() - started) * 1000), grounded,
            validate_analysis_output(final),
            input_tokens,
            output_tokens,
            input_tokens / prompt_seconds if input_tokens and prompt_seconds else None,
            output_tokens / generation_seconds if output_tokens and generation_seconds else None,
            finish_reason,
            finish_reason == "length",
        )
        provenance = {
            "pipeline_version": self.pipeline_version,
            "schema_version": self.context.schema_version,
            "strategy": self.strategy,
            "prompt_version": self.context.prompt_version,
            "rubric_version": self.context.rubric_version,
            "model": getattr(self.provider, "model", "unknown"),
            "transcript_sha256": hashlib.sha256(transcript.encode()).hexdigest(),
            "chunk_strategy_version": f"turns-{self.max_turns}-overlap-{self.overlap_turns}",
            "chunks": len(chunks),
            "passes": metrics.passes,
            "grounding": grounding,
            "grounding_rate": grounded / len(grounding) if grounding else 1.0,
        }
        return PipelineResult(final, metrics, provenance)
