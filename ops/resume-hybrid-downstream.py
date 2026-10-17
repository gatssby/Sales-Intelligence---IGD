#!/usr/bin/env python3
"""Resume immutable hybrid ledger on 9B only; never runs an extractor."""
import argparse
import fcntl
import hashlib
import json
import subprocess
import time
import urllib.request
from pathlib import Path

import jsonschema
from ai_local.closer_insider import build_turns, hydrate_evidence, merge_evidence
from ai_local.closer_insider_pipeline import CloserInsiderPipeline
from ai_local.provider import LocalQwenProvider
from importlib.machinery import SourceFileLoader

runtime = SourceFileLoader("hybrid_runtime", str(Path(__file__).with_name("run-hybrid-local-benchmark.py"))).load_module()


class ValidatedProvider(LocalQwenProvider):
    def complete(self, system, user, *, schema=None, max_tokens=2048, temperature=0.0):
        output = super().complete(system, user, schema=schema, max_tokens=max_tokens, temperature=temperature)
        jsonschema.validate(output, schema)
        return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, required=True)
    args = parser.parse_args()
    root = args.artifact_dir
    with (root / "downstream.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Fail rather than terminating any unrelated healthy server.
        if subprocess.run(["pgrep", "-x", "llama-server"], capture_output=True).returncode == 0:
            raise RuntimeError("llama-server already active; refusing to duplicate or kill it")
        provider = ValidatedProvider(model="qwen3.5-9b", timeout_s=5400)
        extractor = LocalQwenProvider(model="qwen3.5-4b", timeout_s=5400)
        pipeline = CloserInsiderPipeline(provider, evidence_provider=extractor, evidence_max_tokens=6144,
                                         stage_budgets={"commercial": 4096}, ctx_size=32768,
                                         downstream_only=True, checkpoint_dir=root, stage_validator=jsonschema.validate)
        transcript = args.transcript.read_text()
        chunks = pipeline._chunks(build_turns(transcript))
        fingerprint = pipeline._checkpoint_fingerprint(transcript)
        passes = []
        for i, chunk in enumerate(chunks, 1):
            path = root / "chunks" / f"chunk-{i:04d}-evidence.json"
            value = pipeline._load_checkpoint(path, fingerprint, chunk)
            if value is None:
                raise ValueError(f"invalid checkpoint {path.name}; no extraction permitted")
            passes.append(value)
        ledger = json.loads((root / "evidence.json").read_text())
        if ledger != hydrate_evidence(merge_evidence(passes, build_turns(transcript)), build_turns(transcript)):
            raise ValueError("immutable ledger mismatch")
        protected = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [root / "evidence.json", *(root / "chunks").glob("*.json")]}
        status = {"started_at": time.time(), "status": "starting", "evidence_sha256": protected, "model": "qwen3.5-9b"}
        status_path = root / "downstream-status.json"
        status_path.write_text(json.dumps(status, indent=2))
        process = None
        try:
            process, load_ms = runtime.start_server("/home/ubuntu/sales-intelligence-local-llm/models/Qwen3.5-9B-Q4_K_M.gguf", "qwen3.5-9b", root / "llama-9b-downstream.log")
            with urllib.request.urlopen("http://127.0.0.1:18081/v1/models", timeout=10) as response:
                models = json.loads(response.read())
            if not any(m.get("id") == "qwen3.5-9b" for m in models["data"]):
                raise RuntimeError("unexpected runtime model")
            status.update(status="running", load_ms=load_ms, server_pid=process.pid, models=models)
            status_path.write_text(json.dumps(status, indent=2))
            result = pipeline.analyze(transcript)
            output = root.parent / "closer-insider-hybrid-v1.json"
            output.write_text(json.dumps({"strategy": "closer_insider_hybrid_v1", "output": result.final,
                                           "metrics": result.metrics, "provenance": result.provenance}, ensure_ascii=False, indent=2))
            status["status"] = "completed"
        except Exception as exc:
            status.update(status="failed", error=str(exc))
            run_path = root / "run.json"
            run = json.loads(run_path.read_text()) if run_path.exists() else {}
            run.update(status="failed", error=str(exc), stage_budgets=pipeline.stage_budgets)
            temporary = run_path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(run, indent=2))
            temporary.replace(run_path)
            raise
        finally:
            status["finished_at"] = time.time()
            status["evidence_unchanged"] = all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == h for p, h in protected.items())
            status_path.write_text(json.dumps(status, indent=2))
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=60)


if __name__ == "__main__":
    main()
