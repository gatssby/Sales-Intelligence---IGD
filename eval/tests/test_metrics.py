import json
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
from benchmark_metrics import evaluate_record  # noqa: E402


class MetricsTests(unittest.TestCase):
    def test_metrics_detect_grounding_truncation_and_duplicates(self):
        result = {
            "finish_reason": "length",
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
            "metrics": {"latency_ms": 100, "passes": 5, "chunks": 2, "retries": 1},
            "output": {
                "scoreability": "scoreable", "overall_score": 70,
                "opportunity_quality": "medium", "call_outcome": "follow_up", "confidence": 0.7,
                "opportunity_quality_label": "Média", "call_outcome_label": "Follow-up",
                "executive_summary": "Resumo", "strengths": ["x"], "critical_failures": [], "objections": [], "coaching_actions": ["y"],
                "dimensions": [{"key": key, "label": key, "score": 70, "rationale": "x"} for key in ["discovery"]],
                "evidence": [{"timestamp": "", "speaker": "", "criterion": "discovery", "quote": "dor", "interpretation": "x"}, {"timestamp": "", "speaker": "", "criterion": "discovery", "quote": "dor", "interpretation": "x"}],
                "unscorable_reason": None, "requires_human_review": False,
            },
        }
        metric = evaluate_record("Lead: dor", result)
        self.assertTrue(metric["json_valid"])
        self.assertTrue(metric["truncated"])
        self.assertEqual(metric["grounded_evidence_count"], 2)
        self.assertEqual(metric["duplicate_quote_count"], 1)
        self.assertEqual(metric["input_tokens"], 10)


if __name__ == "__main__":
    unittest.main()
