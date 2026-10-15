from __future__ import annotations

PLAYBOOK = """Closer × Insider playbook v1.
Analyze what happened before judging execution. Separate current opportunity fit from future requalification potential. Require evidence IDs for positive and negative claims. Absence is not proof of failure: describe missing behavior and confidence instead. Do not infer tone, pauses, body language, intent, or facts not present in the transcript. Do not use historical scores or legacy rubrics as truth. Unknown is a valid answer.

Evaluate qualitatively: opening and expectations, discovery, diagnosis, qualification, pitch/value connection, objection handling, closing/next step, professionalism, and conversation control. Consider opportunity quality separately from Closer execution. A sale or no sale does not determine Closer quality. Flag possible prior SDR/process issues only as a radar, never as automatic blame.
"""


def evidence_prompt() -> str:
    return PLAYBOOK + """
Pass 1 — evidence extraction only. Return only evidence records. Each record must reference exactly one supplied turn_id. Do not write quotes: Python will hydrate the exact source text. Extract important facts, pains, goals, constraints, objections, commitments, decisions, offer elements and handoff/levantada signals. Use a concise claim and an evidence_type. Do not score or judge the Closer.
"""


def commercial_prompt() -> str:
    return PLAYBOOK + """
Pass 2 — commercial reconstruction. You receive an immutable evidence ledger with exact source text. Return current opportunity fit, future requalification potential, conditions, qualification gaps, urgency, authority, budget/capacity, decision process, availability, outcome and next step. Reference only existing evidence_ids. Do not create evidence, quotes or scores. Do not infer outcome when it is not evidenced.
"""


def closer_prompt() -> str:
    return PLAYBOOK + """
Pass 3 — Closer execution evaluation. You receive only the immutable evidence ledger and commercial state. For each required area, return strong/adequate/weak/unknown, evidence IDs, missing or missed behaviors, rationale and confidence. Do not create evidence IDs. Do not assign numeric scores. Unknown is preferred to inventing a failure.
"""


def critic_prompt() -> str:
    return PLAYBOOK + """
Pass 4 — skeptical critic. Look for over-benevolent assessments: important questions not asked, shallow discovery, incomplete diagnosis, unclear authority/process, unclear capacity, objections not explored, disconnected pitch, digressions, lost control, passive close, and next steps without commitment. Every finding must reference evidence_ids or state an absence_basis grounded in the supplied record. Do not create evidence.
"""


def final_prompt() -> str:
    return PLAYBOOK + """
Pass 5 — final synthesis. Produce a concise qualitative report. Use only the supplied source metadata, immutable evidence ledger, commercial state, Closer evaluation and critic. Do not invent facts, evidence, outcome or quotes. Do not transform future potential into current fit. Preserve uncertainty and human-review requirements. Return evidence_ids only; Python will attach the evidence ledger separately.
"""
