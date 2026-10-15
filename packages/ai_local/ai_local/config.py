from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class LocalQwenSettings:
    profile: str
    endpoint: str
    model: str
    threads: int
    cpu_quota: str
    context_size: int
    timeout_s: float

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "LocalQwenSettings":
        values = os.environ if env is None else env
        profile = values.get("QWEN_PROFILE", "day").lower()
        if profile not in {"day", "night"}:
            raise ValueError("QWEN_PROFILE must be day or night")
        defaults = {"day": (2, "200%"), "night": (4, "380%")}[profile]
        return cls(
            profile=profile,
            endpoint=values.get("QWEN_ENDPOINT", "http://127.0.0.1:18081"),
            model=values.get("QWEN_MODEL", "qwen3.5-9b"),
            threads=int(values.get("QWEN_THREADS", defaults[0])),
            cpu_quota=values.get("QWEN_CPU_QUOTA", defaults[1]),
            context_size=int(values.get("QWEN_CONTEXT_SIZE", "32768")),
            timeout_s=float(values.get("QWEN_TIMEOUT_S", "1800" if profile == "night" else "300")),
        )
