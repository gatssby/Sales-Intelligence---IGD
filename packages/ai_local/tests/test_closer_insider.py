import json
import unittest
from unittest.mock import Mock

from ai_local.closer_insider import (
    CLOSER_INSIDER_PIPELINE_VERSION,
    build_turns,
    classify_source,
    hydrate_evidence,
    merge_evidence,
    normalize_commercial_outcome,
    validate_evidence_refs,
)
from ai_local.closer_insider_pipeline import CloserInsiderPipeline
from ai_local.provider import CompletionMetrics


class CloserInsiderGroundingTests(unittest.TestCase):
    def test_turn_ids_are_deterministic_and_preserve_source_fields(self):
        turns = build_turns("00:01:02 Ana: Olá\nCliente: Quero entender a oferta")
        self.assertEqual([turn.turn_id for turn in turns], ["T000001", "T000002"])
        self.assertEqual(turns[0].timestamp, "00:01:02")
        self.assertEqual(turns[0].speaker, "Ana")
        self.assertEqual(turns[0].text, "Olá")
        self.assertEqual(turns[1].speaker, "Cliente")

    def test_standalone_timestamp_is_carried_into_following_turns(self):
        turns = build_turns("00:01:02\nAna: Olá\nCliente: Sim\n00:02:03\nAna: Próximo")
        self.assertEqual([turn.timestamp for turn in turns], ["00:01:02", "00:01:02", "00:02:03"])

    def test_evidence_is_hydrated_from_turn_id_not_model_quote(self):
        turns = build_turns("Ana: frase exata")
        merged = merge_evidence([{"evidence": [{"evidence_id": "model-id", "turn_id": "T000001", "claim": "fato", "evidence_type": "fact"}]}], turns)
        hydrated = hydrate_evidence(merged, turns)
        self.assertEqual(hydrated[0]["evidence_id"], "E000001")
        self.assertEqual(hydrated[0]["quote"], "frase exata")
        self.assertEqual(hydrated[0]["speaker"], "Ana")
        self.assertNotIn("model-id", json.dumps(hydrated))

    def test_invalid_turn_reference_is_rejected(self):
        with self.assertRaises(ValueError):
            merge_evidence([{"evidence": [{"evidence_id": "x", "turn_id": "T999999", "claim": "x", "evidence_type": "fact"}]}], build_turns("Ana: fato"))

    def test_overlap_dedupes_exact_evidence_but_keeps_distinct_claims_on_same_turn(self):
        turns = build_turns("Ana: O cliente quer clareza sobre preço")
        merged = merge_evidence([
            {"evidence": [
                {"turn_id": "T000001", "claim": "Cliente quer clareza sobre preço", "evidence_type": "goal"},
                {"turn_id": "T000001", "claim": "Cliente quer clareza sobre preço", "evidence_type": "goal"},
                {"turn_id": "T000001", "claim": "Preço é uma preocupação", "evidence_type": "objection"},
            ]},
        ], turns)
        self.assertEqual(len(merged), 2)
        self.assertEqual([item["evidence_id"] for item in merged], ["E000001", "E000002"])
        self.assertEqual({item["evidence_type"] for item in merged}, {"goal", "objection"})

    def test_outcome_without_explicit_outcome_evidence_becomes_unknown(self):
        evidence = [{"claim": "A reunião será reagendada", "evidence_type": "handoff", "quote": "vamos agendar"}]
        self.assertEqual(normalize_commercial_outcome("not_sold", evidence), "unknown")

    def test_source_classification_distinguishes_verbatim_notes_and_partial(self):
        self.assertEqual(classify_source(build_turns("Ana: oi\nCliente: olá\nAna: proposta"), "Ana: oi\nCliente: olá\nAna: proposta"), "verbatim_transcript")
        self.assertEqual(classify_source(build_turns("📝 Observações\nResumo da conversa"), "📝 Observações\nResumo da conversa"), "meeting_notes")
        self.assertEqual(classify_source(build_turns("Ana: oi"), "Ana: oi"), "partial_transcript")


class CloserInsiderPipelineTests(unittest.TestCase):
    def test_pipeline_outputs_artifact_stages_without_new_final_evidence(self):
        provider = Mock()
        provider.model = "qwen3.5-9b"
        provider.completion_history = []
        provider.last_retry_count = 0
        provider.complete.side_effect = [
            {"evidence": [{"evidence_id": "x", "turn_id": "T000002", "claim": "lead quer clareza", "evidence_type": "goal"}]},
            {"current_opportunity_fit": "unknown", "future_requalification_potential": "unknown", "requalification_conditions": [], "qualification_gaps": ["budget"], "urgency": "unknown", "authority": "unknown", "budget_or_capacity": "unknown", "decision_process": "unknown", "availability": "unknown", "outcome": "unknown", "next_step": "unknown", "evidence_ids": ["E000001"]},
            {"opening_and_expectation": {"assessment": "adequate", "positive_evidence_ids": ["E000001"], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "ok", "confidence": 0.7}, "discovery": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "diagnosis": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "qualification": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "pitch_and_value_connection": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "objection_handling": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "closing_and_next_step": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "professionalism": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}, "conversation_control": {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "insufficient", "confidence": 0.3}},
            {"critic_findings": [{"finding": "perguntas não observáveis", "evidence_ids": [], "absence_basis": "nenhum objetivo explícito no ledger", "severity": "material"}], "evidence_ids": []},
            {"executive_summary": "Resumo", "strengths": ["clareza"], "critical_failures": [], "missed_opportunities": [], "coaching_actions": [], "risk_or_compliance_flags": [], "primary_failure": "unknown", "confidence": 0.5, "requires_human_review": True, "evidence_ids": ["E000001"]},
        ]
        for _ in range(5):
            provider.completion_history.append(CompletionMetrics(10, 20, 5.0, 10.0, 1000, "stop"))
        pipeline = CloserInsiderPipeline(provider, max_turns=80, overlap_turns=8)
        result = pipeline.analyze("Ana: abertura\nCliente: lead quer clareza\nAna: encerramento\nCliente: ok")
        self.assertEqual(result.provenance["pipeline_version"], CLOSER_INSIDER_PIPELINE_VERSION)
        self.assertEqual(result.evidence[0]["quote"], "lead quer clareza")
        self.assertEqual(result.final["evidence_ids"], ["E000001"])
        self.assertEqual(result.artifacts["evidence"][0]["evidence_id"], "E000001")
        self.assertEqual(provider.complete.call_count, 5)

    def test_pipeline_preserves_chunk_evidence_and_global_payload_metrics(self):
        provider = Mock()
        provider.model = "qwen3.5-9b"
        provider.completion_history = []
        provider.complete.side_effect = [
            {"evidence": [{"evidence_id": "x", "turn_id": "T000001", "claim": "abertura", "evidence_type": "fact"}]},
            {"evidence": [{"evidence_id": "x", "turn_id": "T000004", "claim": "fechamento", "evidence_type": "commitment"}]},
            {"current_opportunity_fit": "unknown", "future_requalification_potential": "unknown", "requalification_conditions": [], "qualification_gaps": [], "urgency": "unknown", "authority": "unknown", "budget_or_capacity": "unknown", "decision_process": "unknown", "availability": "unknown", "outcome": "unknown", "next_step": "unknown", "evidence_ids": ["E000001"]},
            {k: {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "", "confidence": 0.2} for k in ["opening_and_expectation", "discovery", "diagnosis", "qualification", "pitch_and_value_connection", "objection_handling", "closing_and_next_step", "professionalism", "conversation_control"]},
            {"critic_findings": [], "evidence_ids": []},
            {"executive_summary": "", "strengths": [], "critical_failures": [], "missed_opportunities": [], "coaching_actions": [], "risk_or_compliance_flags": [], "primary_failure": "unknown", "confidence": 0.2, "requires_human_review": True, "evidence_ids": []},
        ]
        pipeline = CloserInsiderPipeline(provider, max_turns=3, overlap_turns=1)
        result = pipeline.analyze("Ana: um\nCliente: dois\nAna: três\nCliente: quatro")
        self.assertEqual(result.metrics["chunks"], 2)
        self.assertEqual(len(result.artifacts["chunks"]), 2)
        self.assertEqual(result.artifacts["chunks"][0]["chunk_id"], "chunk-0001")
        self.assertIn("commercial", result.metrics["global_payloads"])
        self.assertGreater(result.metrics["global_payloads"]["commercial"]["characters"], 0)

    def test_meeting_notes_are_unscorable_without_model_calls(self):
        provider = Mock()
        result = CloserInsiderPipeline(provider).analyze("📝 Observações\nResumo da conversa")
        self.assertEqual(result.final["scoreability"], "unscorable")
        self.assertTrue(result.final["requires_human_review"])
        provider.complete.assert_not_called()

    def test_current_fit_and_future_potential_are_separate(self):
        provider = Mock()
        provider.complete.side_effect = [
            {"evidence": []},
            {"current_opportunity_fit": "low", "future_requalification_potential": "high", "requalification_conditions": ["produto definido"], "qualification_gaps": [], "urgency": "low", "authority": "unknown", "budget_or_capacity": "unknown", "decision_process": "unknown", "availability": "low", "outcome": "disqualified", "next_step": "reavaliar depois", "evidence_ids": []},
            {k: {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "", "confidence": 0.2} for k in ["opening_and_expectation", "discovery", "diagnosis", "qualification", "pitch_and_value_connection", "objection_handling", "closing_and_next_step", "professionalism", "conversation_control"]},
            {"critic_findings": [], "evidence_ids": []},
            {"executive_summary": "", "strengths": [], "critical_failures": [], "missed_opportunities": [], "coaching_actions": [], "risk_or_compliance_flags": [], "primary_failure": "unknown", "confidence": 0.2, "requires_human_review": True, "evidence_ids": []},
        ]
        result = CloserInsiderPipeline(provider).analyze("Ana: abertura\nCliente: contexto\nAna: pergunta\nCliente: depois")
        self.assertEqual(result.commercial_state["current_opportunity_fit"], "low")
        self.assertEqual(result.commercial_state["future_requalification_potential"], "high")


if __name__ == "__main__":
    unittest.main()
