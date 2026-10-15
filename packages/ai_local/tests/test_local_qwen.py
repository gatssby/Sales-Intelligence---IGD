import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from ai_local.chunking import chunk_transcript
from ai_local.config import LocalQwenSettings
from ai_local.pipeline import LocalQwenPipeline
from ai_local.schema import validate_analysis_output, validation_errors


class SchemaTests(unittest.TestCase):
    def test_json_schema_artifact_matches_runtime_contract_shape(self):
        artifact = json.loads((Path(__file__).parents[1] / "ai_local" / "schema.json").read_text())
        self.assertEqual(set(artifact["required"]), set(__import__("ai_local.schema", fromlist=["ANALYSIS_JSON_SCHEMA"]).ANALYSIS_JSON_SCHEMA["required"]))

    def test_valid_scoreable_output_has_expected_contract(self):
        output = {
            "scoreability": "scoreable",
            "unscorable_reason": None,
            "overall_score": 75,
            "opportunity_quality": "medium",
            "opportunity_quality_label": "Média",
            "call_outcome": "follow_up",
            "call_outcome_label": "Follow-up",
            "confidence": 0.8,
            "executive_summary": "Resumo",
            "strengths": [],
            "critical_failures": [],
            "objections": [],
            "coaching_actions": [],
            "dimensions": [{"key": "discovery", "label": "Descoberta", "score": 75, "rationale": "Boa"}],
            "evidence": [{"timestamp": "00:10", "speaker": "seller", "criterion": "discovery", "quote": "Tenho uma dor", "interpretation": "Dor explícita"}],
            "requires_human_review": False,
        }
        self.assertEqual(validation_errors(output), [])
        self.assertTrue(validate_analysis_output(output))

    def test_scoreable_output_requires_score_and_null_reason(self):
        output = {"scoreability": "scoreable", "overall_score": None, "unscorable_reason": "x"}
        errors = validation_errors(output)
        self.assertIn("overall_score", errors)
        self.assertIn("unscorable_reason", errors)

    def test_invalid_enum_and_dimension_types_are_rejected(self):
        output = {"scoreability": "maybe", "confidence": 2, "dimensions": [{"key": "x", "score": 101}], "evidence": "bad"}
        errors = validation_errors(output)
        self.assertIn("scoreability", errors)
        self.assertIn("confidence", errors)
        self.assertIn("dimensions", errors)
        self.assertIn("evidence", errors)


class ChunkingTests(unittest.TestCase):
    def test_chunks_preserve_turn_boundaries_and_overlap(self):
        text = "\n".join(f"00:{i:02d} Seller: turn {i}" for i in range(6))
        chunks = chunk_transcript(text, max_turns=3, overlap_turns=1)
        self.assertEqual([len(c.turns) for c in chunks], [3, 3, 2])
        self.assertEqual(chunks[1].turns[0], chunks[0].turns[-1])
        self.assertEqual(chunks[0].source_start, 0)


class PipelineTests(unittest.TestCase):
    def test_day_and_night_profiles_are_explicit_and_safe(self):
        day = LocalQwenSettings.from_env({"QWEN_PROFILE": "day"})
        night = LocalQwenSettings.from_env({"QWEN_PROFILE": "night"})
        self.assertEqual((day.threads, day.cpu_quota), (2, "200%"))
        self.assertEqual((night.threads, night.cpu_quota), (4, "380%"))

    def test_multi_pass_uses_structured_intermediates_and_returns_final(self):
        provider = Mock()
        provider.complete.side_effect = [
            {"facts": [{"claim": "budget", "quote": "Tem orçamento", "source": "00:10"}]},
            {"opportunity_quality": "high", "call_outcome": "follow_up", "objections": []},
            {"dimensions": [{"key": "discovery", "label": "Descoberta", "score": 80, "rationale": "Perguntou"}]},
            {"strengths": ["Perguntas"], "critical_failures": [], "coaching_actions": []},
            {
                "scoreability": "scoreable", "unscorable_reason": None, "overall_score": 80,
                "opportunity_quality": "high", "opportunity_quality_label": "Alta",
                "call_outcome": "follow_up", "call_outcome_label": "Follow-up", "confidence": 0.8,
                "executive_summary": "Boa", "strengths": ["Perguntas"], "critical_failures": [],
                "objections": [], "coaching_actions": ["Continuar"],
                "dimensions": [{"key": "discovery", "label": "Descoberta", "score": 80, "rationale": "Perguntou"}],
                "evidence": [{"timestamp": "00:10", "speaker": "Seller", "criterion": "discovery", "quote": "Tem orçamento", "interpretation": "Budget"}],
                "requires_human_review": False,
            },
        ]
        pipeline = LocalQwenPipeline(provider=provider, dimensions=["discovery"])
        result = pipeline.analyze("00:10 Seller: Tem orçamento")
        self.assertTrue(validate_analysis_output(result.output), validation_errors(result.output))
        self.assertEqual(result.metrics.passes, 5)
        self.assertEqual(provider.complete.call_count, 5)
        self.assertGreaterEqual(result.metrics.grounded_evidence, 1)


if __name__ == "__main__":
    unittest.main()
