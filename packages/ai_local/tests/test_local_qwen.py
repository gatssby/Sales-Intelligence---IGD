import json
from pathlib import Path
import unittest
from unittest.mock import Mock
from unittest.mock import patch
import urllib.error

from ai_local.chunking import chunk_transcript
from ai_local.config import LocalQwenSettings
from ai_local.pipeline import LocalQwenPipeline
from ai_local.provider import CompletionMetrics, LocalQwenProvider
from ai_local.prompting import load_historical_context
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

    def test_historical_context_selects_active_v1_and_loads_versioned_material(self):
        context = load_historical_context()
        self.assertEqual(context.prompt_version, "call-analysis-v1")
        self.assertEqual(context.rubric_version, "insider-production-v1")
        self.assertIn("requires_human_review", context.prompt_text)
        self.assertEqual(context.rubric["status"], "active")
        self.assertEqual(len(context.rubric["dimensions"]), 7)


class ChunkingTests(unittest.TestCase):
    def test_chunks_preserve_turn_boundaries_and_overlap(self):
        text = "\n".join(f"00:{i:02d} Seller: turn {i}" for i in range(6))
        chunks = chunk_transcript(text, max_turns=3, overlap_turns=1)
        self.assertEqual([len(c.turns) for c in chunks], [3, 3, 2])
        self.assertEqual(chunks[1].turns[0], chunks[0].turns[-1])
        self.assertEqual(chunks[0].source_start, 0)
        self.assertEqual([c.chunk_id for c in chunks], ["chunk-0000", "chunk-0001", "chunk-0002"])


class PipelineTests(unittest.TestCase):
    def test_provider_retries_transient_http_failures_with_a_limit(self):
        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self):
                return json.dumps({"choices": [{"message": {"content": json.dumps({"ok": True})}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 20}, "timings": {"prompt_ms": 100, "predicted_ms": 200}}).encode()

        provider = LocalQwenProvider(schema={"type": "object"}, max_retries=1)
        with patch("ai_local.provider.urllib.request.urlopen", side_effect=[urllib.error.URLError("temporary"), Response()]) as urlopen:
            self.assertEqual(provider.complete("s", "u"), {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(provider.last_retry_count, 1)
        self.assertEqual(provider.last_metrics.prompt_tokens_per_second, 100)
        self.assertEqual(provider.last_metrics.generation_tokens_per_second, 100)
        self.assertEqual(provider.last_metrics.finish_reason, "stop")

    def test_provider_retries_malformed_json_response_with_a_limit(self):
        class Response:
            def __init__(self, content):
                self.content = content
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self):
                return json.dumps({"choices": [{"message": {"content": self.content}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}, "timings": {"prompt_ms": 100, "predicted_ms": 100}}).encode()

        provider = LocalQwenProvider(schema={"type": "object"}, max_retries=1)
        with patch("ai_local.provider.urllib.request.urlopen", side_effect=[Response("{"), Response(json.dumps({"ok": True}))]) as urlopen:
            self.assertEqual(provider.complete("s", "u"), {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(provider.last_retry_count, 1)

    def test_day_and_night_profiles_are_explicit_and_safe(self):
        day = LocalQwenSettings.from_env({"QWEN_PROFILE": "day"})
        night = LocalQwenSettings.from_env({"QWEN_PROFILE": "night"})
        self.assertEqual((day.threads, day.cpu_quota), (2, "200%"))
        self.assertEqual((night.threads, night.cpu_quota), (4, "380%"))
        self.assertEqual(day.timeout_s, 300.0)
        self.assertEqual(night.timeout_s, 1800.0)

    def test_multi_pass_uses_structured_intermediates_and_returns_final(self):
        provider = Mock()
        provider.completion_history = []
        responses = [
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
        def complete(*_args, **_kwargs):
            provider.completion_history.append(CompletionMetrics(10, 20, 5.0, 10.0, 1000))
            return responses.pop(0)
        provider.complete.side_effect = complete
        pipeline = LocalQwenPipeline(provider=provider, dimensions=["discovery"])
        result = pipeline.analyze("00:10 Seller: Tem orçamento")
        self.assertTrue(validate_analysis_output(result.output), validation_errors(result.output))
        self.assertEqual(result.metrics.passes, 5)
        self.assertEqual(provider.complete.call_count, 5)
        self.assertEqual(result.metrics.input_tokens, 50)
        self.assertEqual(result.metrics.output_tokens, 100)
        self.assertGreaterEqual(result.metrics.grounded_evidence, 1)
        self.assertEqual(result.provenance["pipeline_version"], "local-qwen-v3-historical")
        self.assertEqual(len(result.provenance["transcript_sha256"]), 64)

    def test_empty_transcript_is_rejected_before_model_calls(self):
        provider = Mock()
        pipeline = LocalQwenPipeline(provider=provider, dimensions=["discovery"])
        with self.assertRaises(ValueError):
            pipeline.analyze("  \n")
        provider.complete.assert_not_called()

    def test_direct_strategy_uses_one_structured_call_and_records_strategy(self):
        provider = Mock()
        provider.complete.return_value = {
            "scoreability": "scoreable", "unscorable_reason": None, "overall_score": 70,
            "opportunity_quality": "medium", "opportunity_quality_label": "Média",
            "call_outcome": "follow_up", "call_outcome_label": "Follow-up", "confidence": 0.7,
            "executive_summary": "Resumo", "strengths": [], "critical_failures": [], "objections": [],
            "coaching_actions": [], "dimensions": [{"key": "discovery", "label": "Descoberta", "score": 70, "rationale": "Ok"}],
            "evidence": [{"timestamp": "00:10", "speaker": "Seller", "criterion": "discovery", "quote": "Tem orçamento", "interpretation": "Budget"}],
            "requires_human_review": False,
        }
        pipeline = LocalQwenPipeline(provider=provider, dimensions=["discovery"], strategy="direct")
        result = pipeline.analyze("00:10 Seller: Tem orçamento")
        self.assertEqual(provider.complete.call_count, 1)
        self.assertEqual(result.metrics.passes, 1)
        self.assertEqual(result.provenance["strategy"], "direct")

    def test_direct_strategy_uses_versioned_sales_context(self):
        provider = Mock()
        provider.last_metrics = CompletionMetrics(10, 20, 5.0, 10.0, 1000)
        provider.last_retry_count = 0
        provider.complete.return_value = {
            "scoreability": "scoreable", "unscorable_reason": None, "overall_score": 70,
            "opportunity_quality": "medium", "opportunity_quality_label": "Média",
            "call_outcome": "follow_up", "call_outcome_label": "Follow-up", "confidence": 0.7,
            "executive_summary": "Resumo", "strengths": [], "critical_failures": [], "objections": [],
            "coaching_actions": [], "dimensions": [{"key": "discovery", "label": "Descoberta", "score": 70, "rationale": "Ok"}],
            "evidence": [{"timestamp": "00:10", "speaker": "Seller", "criterion": "discovery", "quote": "Tem orçamento", "interpretation": "Budget"}],
            "requires_human_review": False,
        }
        pipeline = LocalQwenPipeline(provider=provider, dimensions=["discovery"], strategy="direct")
        result = pipeline.analyze("00:10 Seller: Tem orçamento")
        system_prompt = provider.complete.call_args.args[0]
        self.assertIn("requires_human_review", system_prompt)
        self.assertIn("insider-production-v1", system_prompt)
        self.assertEqual(result.provenance["prompt_version"], "call-analysis-v1")
        self.assertEqual(result.provenance["rubric_version"], "insider-production-v1")
        self.assertEqual(result.metrics.input_tokens, 10)
        self.assertEqual(result.metrics.output_tokens, 20)
        self.assertEqual(result.metrics.prompt_tokens_per_second, 5.0)

    def test_two_pass_strategy_extracts_facts_then_builds_final(self):
        provider = Mock()
        provider.complete.side_effect = [
            {"facts": [{"fact_id": "f1", "kind": "pain", "claim": "Retrabalho", "quote": "Tem retrabalho", "chunk_id": "chunk-0000", "source_start": 0, "source_end": 1}]},
            {
                "scoreability": "scoreable", "unscorable_reason": None, "overall_score": 60,
                "opportunity_quality": "medium", "opportunity_quality_label": "Média",
                "call_outcome": "follow_up", "call_outcome_label": "Follow-up", "confidence": 0.6,
                "executive_summary": "Resumo", "strengths": [], "critical_failures": [], "objections": [],
                "coaching_actions": [], "dimensions": [{"key": "discovery", "label": "Descoberta", "score": 60, "rationale": "Evidência"}],
                "evidence": [{"timestamp": "", "speaker": "Lead", "criterion": "discovery", "quote": "Tem retrabalho", "interpretation": "Dor"}],
                "requires_human_review": False,
            },
        ]
        pipeline = LocalQwenPipeline(provider=provider, dimensions=["discovery"], strategy="two_pass")
        result = pipeline.analyze("Lead: Tem retrabalho")
        self.assertEqual(provider.complete.call_count, 2)
        self.assertEqual(result.metrics.passes, 2)
        self.assertEqual(result.provenance["strategy"], "two_pass")


if __name__ == "__main__":
    unittest.main()
