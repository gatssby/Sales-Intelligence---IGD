#!/usr/bin/env python3
"""Validate completed regressions before publishing a comparison; no shell heredocs."""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def validated(path):
    value = json.loads(path.read_text())
    if value.get("valid") is not True:
        raise ValueError(f"invalid regression: {path}")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--wait", action="store_true")
    args = parser.parse_args()
    paths = [args.reference / "regression.json", args.base / "regression.json"]
    while not all(p.is_file() for p in paths):
        if not args.wait:
            raise FileNotFoundError("both regression artifacts are required")
        time.sleep(300)
    for path in paths:
        validated(path)
    subprocess.run([sys.executable, "ops/compare-closer-benchmarks.py",
                    "--reference", str(args.reference / "closer-insider-v1"),
                    "--candidate", str(args.base / "closer-insider-hybrid-v1"),
                    "--reference-regression", str(paths[0]), "--candidate-regression", str(paths[1]),
                    "--output", str(args.base / "comparison.json")], check=True)


if __name__ == "__main__":
    main()
