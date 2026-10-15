import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
from compare_historical import compare_record


class HistoricalComparisonTests(unittest.TestCase):
    def test_comparison_reports_reference_models_and_grounding(self):
        qwen = {
            "call_id": "c1",
            "output": {
                "overall_score": 70,
                "call_outcome": "follow_up",
                "evidence": [{"quote": "Inventado", "criterion": "discovery"}],
            },
            "metrics": {"grounded_evidence": 0, "schema_valid": True},
            "provenance": {"strategy": "direct"},
        }
        historical = [{
            "model": "gpt-test",
            "score": 80,
            "result_json": {
                "overall_score": 80,
                "call_outcome": "follow_up",
                "dimensions": [{"key": "discovery", "score": 80}],
                "evidence": [{"quote": "Dor explícita", "criterion": "discovery"}],
            },
        }]
        result = compare_record(qwen, historical, "Lead: Dor explícita")
        self.assertEqual(result["historical_models"], ["gpt-test"])
        self.assertEqual(result["qwen_grounding_rate"], 0.0)
        self.assertEqual(result["historical_score_values"], [80])
        self.assertEqual(result["outcome_agreement"], True)
        self.assertEqual(result["qwen_evidence_overlap_count"], 0)


if __name__ == "__main__":
    unittest.main()