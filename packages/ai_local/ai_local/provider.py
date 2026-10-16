from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .schema import ANALYSIS_JSON_SCHEMA


@dataclass(frozen=True)
class CompletionMetrics:
    input_tokens: int | None
    output_tokens: int | None
    prompt_tokens_per_second: float | None
    generation_tokens_per_second: float | None
    latency_ms: int
    finish_reason: str | None = None
    prompt_ms: float | None = None
    generation_ms: float | None = None


@dataclass(frozen=True)
class Completion:
    output: dict[str, Any]
    metrics: CompletionMetrics


class LocalQwenProvider:
    def __init__(self, endpoint: str = "http://127.0.0.1:18081", model: str = "qwen3.5-9b", timeout_s: float = 300.0, schema: dict[str, Any] | None = None, max_retries: int = 1):
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.timeout_s = timeout_s
        self.schema = schema or ANALYSIS_JSON_SCHEMA
        self.max_retries = max(0, max_retries)
        self.last_metrics: CompletionMetrics | None = None
        self.completion_history: list[CompletionMetrics] = []
        self.last_retry_count = 0
        self.last_finish_reason: str | None = None
        self.last_response_content: str | dict[str, Any] | None = None
        self.last_response_usage: dict[str, Any] = {}

    def health(self) -> bool:
        request = urllib.request.Request(f"{self.endpoint}/health")
        with urllib.request.urlopen(request, timeout=min(self.timeout_s, 10)) as response:
            return response.status == 200

    def complete(self, system: str, user: str, *, schema: dict[str, Any] | None = None, max_tokens: int = 2048, temperature: float = 0.0) -> dict[str, Any]:
        started = time.monotonic()
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            "response_format": {"type": "json_schema", "json_schema": {"name": "analysis_output", "schema": schema or self.schema}},
        }
        request = urllib.request.Request(
            f"{self.endpoint}/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        self.last_retry_count = 0
        result: dict[str, Any] | None = None
        body: dict[str, Any] | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                    body = json.loads(response.read())
                assert body is not None
                choice = body["choices"][0]
                content = choice["message"]["content"]
                self.last_finish_reason = choice.get("finish_reason")
                self.last_response_content = content
                usage = body.get("usage", {})
                self.last_response_usage = usage
                timings = body.get("timings", {})
                elapsed_ms = int((time.monotonic() - started) * 1000)
                prompt_ms = timings.get("prompt_ms")
                generation_ms = timings.get("predicted_ms") or timings.get("generation_ms")
                self.last_metrics = CompletionMetrics(
                    usage.get("prompt_tokens"), usage.get("completion_tokens"),
                    usage.get("prompt_tokens", 0) / (prompt_ms / 1000) if prompt_ms else None,
                    usage.get("completion_tokens", 0) / (generation_ms / 1000) if generation_ms else None,
                    elapsed_ms, self.last_finish_reason, prompt_ms, generation_ms,
                )
                self.completion_history.append(self.last_metrics)
                result = json.loads(content) if isinstance(content, str) else content
                break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
                if attempt >= self.max_retries:
                    raise
                self.last_retry_count += 1
                time.sleep(0.1 * (2 ** attempt))
        if body is None or result is None:
            raise RuntimeError("provider request ended without a response body")
        return result
