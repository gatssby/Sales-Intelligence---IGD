from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .config import LocalQwenSettings
from .pipeline import LocalQwenPipeline
from .provider import LocalQwenProvider


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m ai_local", description="Run local Qwen analysis in shadow mode.")
    sub = parser.add_subparsers(dest="command", required=True)
    analyze = sub.add_parser("analyze", help="analyze one transcript without writing production state")
    analyze.add_argument("--call-id", required=True)
    analyze.add_argument("--transcript-path", type=Path, required=True, help="local transcript file; production DB is never modified")
    analyze.add_argument("--transcript-id", default=None)
    analyze.add_argument("--profile", choices=["day", "night"], default=None)
    analyze.add_argument("--endpoint", default=None)
    analyze.add_argument("--timeout", type=float, default=None)
    analyze.add_argument("--output", type=Path, default=None)
    analyze.add_argument("--pipeline-version", default="local-qwen-v2")
    analyze.add_argument("--strategy", choices=["direct", "multipass"], default="direct")
    analyze.add_argument("--max-turns", type=int, default=80)
    analyze.add_argument("--overlap-turns", type=int, default=8)
    analyze.add_argument("--dry-run", action="store_true", help="check input, resources, and health without inference")
    return parser


def run_analyze(args: argparse.Namespace) -> int:
    if not args.transcript_path.is_file():
        raise SystemExit(f"transcript not found: {args.transcript_path}")
    env = dict(__import__("os").environ)
    if args.profile:
        env["QWEN_PROFILE"] = args.profile
    if args.endpoint:
        env["QWEN_ENDPOINT"] = args.endpoint
    if args.timeout is not None:
        env["QWEN_TIMEOUT_S"] = str(args.timeout)
    settings = LocalQwenSettings.from_env(env)
    transcript = args.transcript_path.read_text(encoding="utf-8")
    output_path = args.output or Path("artifacts/local-qwen") / f"{args.call_id}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    provider = LocalQwenProvider(endpoint=settings.endpoint, model=settings.model, timeout_s=settings.timeout_s)
    if not provider.health():
        raise SystemExit(f"Qwen health check failed at {settings.endpoint}")
    plan = {"call_id": args.call_id, "transcript_id": args.transcript_id, "profile": settings.profile, "endpoint": settings.endpoint, "pipeline_version": args.pipeline_version, "strategy": args.strategy, "output": str(output_path), "shadow": True, "dry_run": args.dry_run}
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0
    pipeline = LocalQwenPipeline(provider, dimensions=["opening_rapport", "discovery", "qualification", "diagnosis", "value_presentation", "objection_handling", "closing_next_steps"], max_turns=args.max_turns, overlap_turns=args.overlap_turns, pipeline_version=args.pipeline_version, strategy=args.strategy)
    result = pipeline.analyze(transcript)
    payload = {**plan, "dry_run": False, "output": result.output, "metrics": result.metrics.__dict__, "provenance": {**result.provenance, "transcript_id": args.transcript_id}}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"saved": str(output_path), "call_id": args.call_id, "shadow": True, "metrics": payload["metrics"]}, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "analyze":
        return run_analyze(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
