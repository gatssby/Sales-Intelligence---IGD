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
        body: dict[str, Any] | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                    body = json.loads(response.read())
                break
            except (urllib.error.URLError, TimeoutError):
                if attempt >= self.max_retries:
                    raise
                time.sleep(0.1 * (2 ** attempt))
        if body is None:
            raise RuntimeError("provider request ended without a response body")
        content = body["choices"][0]["message"]["content"]
        result = json.loads(content) if isinstance(content, str) else content
        usage = body.get("usage", {})
        elapsed_ms = int((time.monotonic() - started) * 1000)
        self.last_metrics = CompletionMetrics(
            usage.get("prompt_tokens"), usage.get("completion_tokens"), None, None, elapsed_ms
        )
        return result
