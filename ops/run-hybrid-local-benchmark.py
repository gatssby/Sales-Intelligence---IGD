#!/usr/bin/env python3
"""Run the experimental 4B evidence -> 9B downstream benchmark."""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
import urllib.request
from pathlib import Path

from ai_local.closer_insider_pipeline import CloserInsiderPipeline
from ai_local.provider import LocalQwenProvider


BIN = "/home/ubuntu/sales-intelligence-local-llm/llama.cpp/build/bin/llama-server"


def stop_servers() -> None:
    result = subprocess.run(["pgrep", "-x", "llama-server"], capture_output=True, text=True)
    for value in result.stdout.split():
        try:
            os.kill(int(value), signal.SIGTERM)
        except ProcessLookupError:
            pass
    time.sleep(2)


def start_server(model_path: str, alias: str, log_path: Path) -> tuple[subprocess.Popen[bytes], int]:
    stop_servers()
    started = time.monotonic()
    log = log_path.open("ab")
    process = subprocess.Popen(
        [
            BIN,
            "--model", model_path,
            "--alias", alias,
            "--host", "127.0.0.1",
            "--port", "18081",
            "--threads", "4",
            "--threads-batch", "4",
            "--ctx-size", "32768",
            "--parallel", "1",
            "--reasoning", "off",
            "--no-context-shift",
            "--metrics",
        ],
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    for _ in range(360):
        try:
            with urllib.request.urlopen("http://127.0.0.1:18081/health", timeout=2) as response:
                if response.status == 200:
                    log.close()
                    return process, int((time.monotonic() - started) * 1000)
        except Exception:
            time.sleep(1)
    log.close()
    process.terminate()
    raise RuntimeError(f"runtime did not become healthy for {alias}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-4b", required=True)
    parser.add_argument("--model-9b", required=True)
    args = parser.parse_args()

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    runtime_path = args.artifact_dir / "runtime-switch.json"
    events: list[dict[str, object]] = []
    runtime: dict[str, object] = {"strategy": "closer_insider_hybrid_v1", "events": events}
    processes: list[subprocess.Popen[bytes]] = []

    def record(event: str, **values: object) -> None:
        events.append({"event": event, "time": time.time(), **values})
        runtime_path.write_text(json.dumps(runtime, indent=2), encoding="utf-8")

    try:
        record("starting_4b")
        four_b, four_b_load_ms = start_server(args.model_4b, "qwen3.5-4b", args.artifact_dir / "llama-4b.log")
        processes.append(four_b)
        record("4b_ready", load_ms=four_b_load_ms)

        evidence_provider = LocalQwenProvider(endpoint="http://127.0.0.1:18081", model="qwen3.5-4b", timeout_s=5400)
        downstream_provider = LocalQwenProvider(endpoint="http://127.0.0.1:18081", model="qwen3.5-9b", timeout_s=5400)

        def switch_to_9b() -> None:
            switch_started = time.monotonic()
            record("switch_start")
            four_b.terminate()
            four_b.wait(timeout=60)
            record("4b_stopped")
            nine_b, nine_b_load_ms = start_server(args.model_9b, "qwen3.5-9b", args.artifact_dir / "llama-9b.log")
            processes.append(nine_b)
            record("9b_ready", load_ms=nine_b_load_ms)
            runtime["switch_total_ms"] = int((time.monotonic() - switch_started) * 1000)
            runtime_path.write_text(json.dumps(runtime, indent=2), encoding="utf-8")

        pipeline = CloserInsiderPipeline(
            downstream_provider,
            evidence_provider=evidence_provider,
            evidence_max_tokens=4096,
            before_global_stages=switch_to_9b,
            max_turns=80,
            overlap_turns=8,
            checkpoint_dir=args.artifact_dir,
        )
        result = pipeline.analyze(args.transcript.read_text(encoding="utf-8"))
        runtime["status"] = "completed"
        runtime_path.write_text(json.dumps(runtime, indent=2), encoding="utf-8")
        payload = {
            "strategy": "closer_insider_hybrid_v1",
            "transcript": str(args.transcript),
            "output": result.final,
            "metrics": result.metrics,
            "provenance": result.provenance,
            "runtime": runtime,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0
    except Exception:
        runtime["status"] = "failed"
        runtime_path.write_text(json.dumps(runtime, indent=2), encoding="utf-8")
        raise
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
