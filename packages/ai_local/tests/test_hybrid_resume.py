import json
import tempfile
import unittest
import subprocess
import importlib.util
from pathlib import Path
from unittest.mock import Mock

from ai_local.closer_insider_pipeline import CloserInsiderPipeline


class HybridResumeTests(unittest.TestCase):
    def test_global_reuse_then_budget_invalidation(self):
        provider = Mock(model="qwen3.5-9b")
        provider.complete.return_value = {"outcome": "unknown", "evidence_ids": []}
        with tempfile.TemporaryDirectory() as directory:
            first = CloserInsiderPipeline(provider, checkpoint_dir=directory)
            args = ("commercial", "source", {}, "prompt", {}, 2048, set(), [])
            first._run_global_stage(*args)
            _, metrics = first._run_global_stage(*args)
            self.assertTrue(metrics["reused_checkpoint"])
            self.assertEqual(provider.complete.call_count, 1)
            second = CloserInsiderPipeline(provider, checkpoint_dir=directory, stage_budgets={"commercial": 4096})
            _, metrics = second._run_global_stage("commercial", "source", {}, "prompt", {}, 4096, set(), [])
            self.assertFalse(metrics["reused_checkpoint"])
            self.assertEqual(provider.complete.call_count, 2)

    def test_postprocessor_syntax_and_rejects_invalid_regression(self):
        root = Path(__file__).resolve().parents[3]
        subprocess.run(["bash", "-n", str(root / "ops/resume-hybrid-downstream-chain.sh")], check=True)
        path = root / "ops/postprocess-hybrid-benchmark.py"
        spec = importlib.util.spec_from_file_location("postprocessor", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            regression = Path(directory) / "regression.json"
            regression.write_text('{"valid": false}')
            with self.assertRaises(ValueError):
                module.validated(regression)
            regression.write_text('{"valid": true}')
            self.assertTrue(module.validated(regression)["valid"])

    def test_budget_override_preserves_baseline_and_evidence_fingerprint(self):
        provider = Mock(model="qwen3.5-9b")
        baseline = CloserInsiderPipeline(provider)
        hybrid = CloserInsiderPipeline(provider, stage_budgets={"commercial": 4096})
        self.assertEqual(baseline.stage_budgets["commercial"], 2048)
        self.assertEqual(hybrid.stage_budgets["commercial"], 4096)
        self.assertEqual(baseline._checkpoint_fingerprint("source"), hybrid._checkpoint_fingerprint("source"))
        args = ("commercial", "source", {}, "prompt", {}, 4096)
        self.assertNotEqual(baseline._global_fingerprint(*args), hybrid._global_fingerprint(*args))
        args = ("final", "source", {}, "prompt", {}, 3072)
        self.assertNotEqual(baseline._global_fingerprint(*args), hybrid._global_fingerprint(*args))

    def test_preflight_blocks_before_completion_and_persists_numbers(self):
        provider = Mock(model="qwen3.5-9b")
        provider.count_prompt_tokens.return_value = 30000
        with tempfile.TemporaryDirectory() as directory:
            pipeline = CloserInsiderPipeline(provider, ctx_size=32768, checkpoint_dir=directory)
            with self.assertRaisesRegex(ValueError, "context preflight"):
                pipeline._run_global_stage("commercial", "source", {}, "prompt", {}, 4096, set(), [])
            provider.complete.assert_not_called()
            report = json.loads((Path(directory) / "commercial.preflight.json").read_text())
            self.assertFalse(report["safe"])
            self.assertEqual(report["headroom"], -1328)

    def test_downstream_only_rejects_missing_evidence_before_inference(self):
        provider = Mock(model="qwen3.5-9b")
        with tempfile.TemporaryDirectory() as directory:
            pipeline = CloserInsiderPipeline(provider, checkpoint_dir=directory, downstream_only=True)
            with self.assertRaisesRegex(ValueError, "evidence checkpoint"):
                pipeline.analyze("Agent: hello\nLead: need\nAgent: next\nLead: yes")
            provider.complete.assert_not_called()
