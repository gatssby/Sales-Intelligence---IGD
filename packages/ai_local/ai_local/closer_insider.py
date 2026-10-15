from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

CLOSER_INSIDER_PIPELINE_VERSION = "closer-insider-v1"
CLOSER_INSIDER_PLAYBOOK_VERSION = "closer-insider-playbook-v1"
TURN_RE = re.compile(r"^\s*(?:(?P<timestamp>\d{1,2}:\d{2}(?::\d{2})?)\s+)?(?:(?P<speaker>[^:]{1,100}):\s+)?(?P<text>.*\S)\s*$")


@dataclass(frozen=True)
class Turn:
    turn_id: str
    source_index: int
    raw: str
    text: str
    speaker: str | None
    timestamp: str | None


def build_turns(transcript: str) -> list[Turn]:
    turns: list[Turn] = []
    pending_timestamp: str | None = None
    for index, raw in enumerate(transcript.splitlines()):
        if not raw.strip():
            continue
        standalone_timestamp = re.match(r"^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$", raw)
        if standalone_timestamp:
            pending_timestamp = standalone_timestamp.group(1)
            continue
        match = TURN_RE.match(raw)
        if not match:
            turns.append(Turn(f"T{len(turns) + 1:06d}", index, raw, raw.strip(), None, pending_timestamp))
            continue
        turns.append(Turn(
            f"T{len(turns) + 1:06d}", index, raw,
            match.group("text").strip(),
            match.group("speaker").strip() if match.group("speaker") else None,
            match.group("timestamp") or pending_timestamp,
        ))
    return turns


def classify_source(turns: list[Turn], transcript: str) -> str:
    lowered = transcript.lower()
    if "📝 observações" in lowered or "resumo da conversa" in lowered or "notas da reunião" in lowered:
        return "meeting_notes"
    if len(turns) < 2:
        return "partial_transcript"
    timestamp_count = sum(1 for turn in turns if turn.timestamp)
    speaker_count = len({turn.speaker for turn in turns if turn.speaker})
    if (timestamp_count == 0 and speaker_count < 2):
        return "partial_transcript"
    if "transcrição" in lowered or timestamp_count >= 2 or speaker_count >= 2:
        return "verbatim_transcript"
    return "unknown"


def source_metadata(turns: list[Turn], transcript: str) -> dict[str, Any]:
    source_type = classify_source(turns, transcript)
    if source_type == "verbatim_transcript":
        quality = "high"
        scoreability = "scoreable"
        review = False
    elif source_type == "partial_transcript":
        quality = "low"
        scoreability = "unscorable"
        review = True
    elif source_type == "meeting_notes":
        quality = "low"
        scoreability = "unscorable"
        review = True
    else:
        quality = "unknown"
        scoreability = "unscorable"
        review = True
    return {"source_type": source_type, "source_quality": quality, "scoreability": scoreability, "requires_human_review": review}


def normalize_commercial_outcome(outcome: str, evidence: list[dict[str, Any]]) -> str:
    if outcome == "unknown":
        return outcome
    text = " ".join(str(item.get(field, "")) for item in evidence for field in ("claim", "quote")).lower()
    if outcome == "sold" and any(token in text for token in ("comprou", "contratou", "fechou", "pagamento aprovado", "vamos começar")):
        return outcome
    if outcome == "not_sold" and any(token in text for token in ("não comprou", "não vai comprar", "não tenho interesse", "sem interesse", "desistiu")):
        return outcome
    if outcome == "disqualified" and any(token in text for token in ("não se encaixa", "não tem fit", "fora do perfil", "não é elegível")):
        return outcome
    if outcome == "follow_up" and any(token in text for token in ("agendar", "agenda", "reunião", "retomar", "mandar mensagem")):
        return outcome
    return "unknown"


def _turn_map(turns: Iterable[Turn]) -> dict[str, Turn]:
    return {turn.turn_id: turn for turn in turns}


def merge_evidence(pass_outputs: list[dict[str, Any]], turns: list[Turn]) -> list[dict[str, Any]]:
    turn_map = _turn_map(turns)
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for output in pass_outputs:
        for item in output.get("evidence", []):
            turn_id = item.get("turn_id")
            if turn_id not in turn_map:
                raise ValueError(f"unknown turn_id in evidence: {turn_id}")
            key = (turn_id, item.get("claim", "").strip(), item.get("evidence_type", ""))
            if key in seen:
                continue
            seen.add(key)
            merged.append({
                "evidence_id": f"E{len(merged) + 1:06d}",
                "turn_id": turn_id,
                "claim": item.get("claim", "").strip(),
                "evidence_type": item.get("evidence_type", "other"),
            })
    return merged


def hydrate_evidence(ledger: list[dict[str, Any]], turns: list[Turn]) -> list[dict[str, Any]]:
    turn_map = _turn_map(turns)
    hydrated: list[dict[str, Any]] = []
    for item in ledger:
        turn = turn_map.get(item["turn_id"])
        if turn is None:
            raise ValueError(f"unknown turn_id in ledger: {item['turn_id']}")
        hydrated.append({**item, "speaker": turn.speaker, "timestamp": turn.timestamp, "quote": turn.text})
    return hydrated


def validate_evidence_refs(value: Any, valid_ids: set[str], *, field_name: str = "evidence_ids") -> None:
    if not isinstance(value, list) or any(not isinstance(item, str) or item not in valid_ids for item in value):
        raise ValueError(f"invalid {field_name}")


def validate_stage_references(value: Any, valid_ids: set[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key.endswith("evidence_ids"):
                validate_evidence_refs(child, valid_ids, field_name=key)
            else:
                validate_stage_references(child, valid_ids)
    elif isinstance(value, list):
        for item in value:
            validate_stage_references(item, valid_ids)
