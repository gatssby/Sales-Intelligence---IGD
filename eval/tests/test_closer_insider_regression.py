import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parents[2] / "packages" / "ai_local"))

from closer_insider_regression import validate_run  # noqa: E402
from ai_local.closer_insider import build_turns  # noqa: E402
from ai_local.closer_insider_pipeline import CloserInsiderPipeline  # noqa: E402


class CloserInsiderRegressionTests(unittest.TestCase):
    def _write_fixture(self, root: Path, transcript: str, *, bad_quote: bool = False) -> None:
        turns = [turn.__dict__ for turn in build_turns(transcript)]
        evidence = [{"evidence_id": "E000001", "turn_id": "T000001", "claim": "abertura", "evidence_type": "fact", "speaker": "Ana", "timestamp": None, "quote": "errado" if bad_quote else "Olá"}]
        commercial = {"current_opportunity_fit": "unknown", "future_requalification_potential": "unknown", "requalification_conditions": [], "qualification_gaps": [], "urgency": "unknown", "authority": "unknown", "budget_or_capacity": "unknown", "decision_process": "unknown", "availability": "unknown", "outcome": "unknown", "next_step": "unknown", "evidence_ids": ["E000001"]}
        areas = ["opening_and_expectation", "discovery", "diagnosis", "qualification", "pitch_and_value_connection", "objection_handling", "closing_and_next_step", "professionalism", "conversation_control"]
        closer = {key: {"assessment": "unknown", "positive_evidence_ids": [], "negative_evidence_ids": [], "missing_or_missed_behaviors": [], "rationale": "", "confidence": 0.2} for key in areas}
        critic = {"critic_findings": [], "evidence_ids": []}
        final = {"executive_summary": "", "strengths": [], "critical_failures": [], "missed_opportunities": [], "coaching_actions": [], "risk_or_compliance_flags": [], "primary_failure": "unknown", "confidence": 0.2, "requires_human_review": True, "evidence_ids": []}
        metrics = {"chunks": 1, "schema_valid": True, "raw_evidence_count": 1, "duplicates_removed": 0, "invalid_evidence_ids": 0, "latency_ms": 1, "global_payloads": {}, "stage_metrics": {}}
        source = {"source_type": "verbatim_transcript", "source_quality": "high", "scoreability": "scoreable", "requires_human_review": False}
        run = {"provenance": {"pipeline_version": "closer-insider-v1"}}
        for name, value in {"turns": turns, "evidence": evidence, "commercial_state": commercial, "closer_evaluation": closer, "critic": critic, "final": final, "metrics": metrics, "source": source, "run": run}.items():
            (root / f"{name}.json").write_text(json.dumps(value), encoding="utf-8")
        pipeline = CloserInsiderPipeline(object(), max_turns=80, overlap_turns=8)
        chunk = pipeline._chunks(build_turns(transcript))[0]
        (root / "chunks").mkdir()
        checkpoint = {"checkpoint_version": 1, "fingerprint": pipeline._checkpoint_fingerprint(transcript), "chunk_id": "chunk-0001", "turn_ids": [turn.turn_id for turn in chunk], "evidence": []}
        (root / "chunks" / "chunk-0001-evidence.json").write_text(json.dumps(checkpoint), encoding="utf-8")

    def test_valid_run_passes_deterministic_grounding_and_checkpoint_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript = "Ana: Olá\nCliente: Tudo bem"
            self._write_fixture(root, transcript)
            report = validate_run(transcript, root)
            self.assertTrue(report["valid"], report)
            self.assertEqual(report["quote_mismatches"], 0)
            self.assertTrue(report["checkpoint"]["valid"])

    def test_quote_mismatch_and_chunking_change_fail_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript = "Ana: Olá\nCliente: Tudo bem"
            self._write_fixture(root, transcript, bad_quote=True)
            report = validate_run(transcript, root, max_turns=1, overlap_turns=0)
            self.assertFalse(report["valid"])
            self.assertEqual(report["quote_mismatches"], 1)
            self.assertIn("checkpoint set is incomplete or incompatible", report["errors"])


if __name__ == "__main__":
    unittest.main()
