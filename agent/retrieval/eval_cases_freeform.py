"""
Freeform retrieval eval cases for Phase 3 hybrid evaluation.

These cases represent paraphrased, free-text learner questions — the surface
where metadata-only retrieval is weakest and hybrid retrieval is expected to win.

Each case has a `question` (user's words) and a `current_item` (the card
being studied). The expected_note_id is the contrast note that should be
retrieved. Cases where no note should be retrieved have expected_note_id=None.

25 cases across 6 buckets:
  formal_register    (6) — paraphrased "make it formal" questions
  voice              (4) — passive/active voice, flip subject/object
  clause_combination (4) — combining sentences, clause types
  phrase_rephrasing  (4) — phrase-level formality questions
  domain_register    (4) — domain-specific vocabulary questions
  no_hit_freeform    (3) — questions with no matching contrast note
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class FreeformEvalCase:
    case_id: str
    question: str
    current_item: dict[str, Any]
    expected_note_id: str | None
    description: str = ""
    bucket: str = "freeform"


def _item(
    item_id: str,
    *,
    category: str = "sentence",
    topic: str = "daily",
    type_: str = "substitution",
    instruction: str = "",
    prompt: str = "",
    answer: str = "",
) -> dict[str, Any]:
    return {
        "id": item_id,
        "category": category,
        "topic": topic,
        "type": type_,
        "instruction": instruction,
        "prompt": prompt,
        "answer": answer,
        "expected_answer": answer,
        "user_answer": "",
        "feedback": "incorrect",
    }


def all_freeform_cases() -> list[FreeformEvalCase]:
    return [

        # ── formal_register ────────────────────────────────────────────────────
        FreeformEvalCase(
            case_id="freeform_formal_001",
            question="Why does my sentence sound too casual for a professional email?",
            current_item=_item("en03", instruction="Replace the bracketed word with a more formal synonym.",
                               prompt="We need to [get] approval first.", answer="obtain"),
            expected_note_id="en_formal_register_precision",
            description="Paraphrase of 'this is informal' → formal register note.",
            bucket="formal_register",
        ),
        FreeformEvalCase(
            case_id="freeform_formal_002",
            question="What's the difference between everyday language and business language?",
            current_item=_item("en16", topic="work", instruction="Express this casually-worded idea in formal English.",
                               prompt="He's really good at his job.", answer="He demonstrates exceptional professional competence."),
            expected_note_id="en_formal_register_precision",
            description="Conceptual question about register → formal register note.",
            bucket="formal_register",
        ),
        FreeformEvalCase(
            case_id="freeform_formal_003",
            question="How do I make this rewrite sound more professional?",
            current_item=_item("en_w3", topic="work", type_="transformation",
                               instruction="Rewrite in formal business language.",
                               prompt="We didn't hit our targets this quarter."),
            expected_note_id="en_work_formal_register",
            description="Paraphrase of 'make it formal' for work domain → work formal register.",
            bucket="formal_register",
        ),
        FreeformEvalCase(
            case_id="freeform_formal_004",
            question="What does it mean to use a precise synonym instead of a vague one?",
            current_item=_item("en01", instruction="Replace the bracketed word with a more formal synonym.",
                               prompt="The manager [said] the policy had changed.", answer="stated"),
            expected_note_id="en_precise_synonym_choice",
            description="Paraphrase of 'why this word' → precise synonym note.",
            bucket="formal_register",
        ),
        FreeformEvalCase(
            case_id="freeform_formal_005",
            question="Why do I need to replace simple words with fancier ones here?",
            current_item=_item("en05", instruction="Replace the bracketed word with a more formal synonym.",
                               prompt="Please [look at] the attached document.", answer="review"),
            expected_note_id="en_formal_register_precision",
            description="Casual paraphrase of 'why use formal synonyms' → formal register.",
            bucket="formal_register",
        ),
        FreeformEvalCase(
            case_id="freeform_formal_006",
            question="This feels like academic writing — what's the pattern I'm learning?",
            current_item=_item("en18", topic="daily", type_="translation",
                               instruction="Paraphrase in academic style.",
                               prompt="Everyone knows this doesn't work."),
            expected_note_id="en_academic_formal_register",
            description="Learner identifies academic register → academic formal register note.",
            bucket="formal_register",
        ),

        # ── voice ──────────────────────────────────────────────────────────────
        FreeformEvalCase(
            case_id="freeform_voice_001",
            question="How do I flip the subject and the object around in a sentence?",
            current_item=_item("en10", topic="work", type_="transformation",
                               instruction="Transform to passive voice.",
                               prompt="The committee reviewed the proposal.",
                               answer="The proposal was reviewed by the committee."),
            expected_note_id="en_passive_vs_active_voice",
            description="Paraphrase of 'flip subject/object' → passive/active voice note.",
            bucket="voice",
        ),
        FreeformEvalCase(
            case_id="freeform_voice_002",
            question="What grammar rule makes the thing being acted on come first?",
            current_item=_item("en11", topic="work", type_="transformation",
                               instruction="Rewrite using passive voice.",
                               prompt="The engineer designed the system."),
            expected_note_id="en_passive_vs_active_voice",
            description="Description of passive construction → passive/active voice note.",
            bucket="voice",
        ),
        FreeformEvalCase(
            case_id="freeform_voice_003",
            question="Why would I want to hide who did the action in a sentence?",
            current_item=_item("en12", topic="work", type_="transformation",
                               instruction="Transform to passive voice.",
                               prompt="The manager approved the budget."),
            expected_note_id="en_passive_vs_active_voice",
            description="Motivation for passive voice → passive/active voice note.",
            bucket="voice",
        ),
        FreeformEvalCase(
            case_id="freeform_voice_004",
            question="What's the difference between the doer and the receiver in a sentence?",
            current_item=_item("en_pv1", topic="work", type_="transformation",
                               instruction="Rewrite in active voice.",
                               prompt="The report was submitted by the team."),
            expected_note_id="en_passive_vs_active_voice",
            description="Doer vs receiver → passive/active voice note.",
            bucket="voice",
        ),

        # ── clause_combination ─────────────────────────────────────────────────
        FreeformEvalCase(
            case_id="freeform_clause_001",
            question="How do I turn two short sentences into one elegant sentence?",
            current_item=_item("en07", type_="transformation",
                               instruction="Combine using a participle clause.",
                               prompt="She finished the report. She sent it to the manager.",
                               answer="Having finished the report, she sent it to the manager."),
            expected_note_id="en_participle_clause_combination",
            description="Paraphrase of 'combine sentences' → participle clause note.",
            bucket="clause_combination",
        ),
        FreeformEvalCase(
            case_id="freeform_clause_002",
            question="What's the grammar pattern that uses -ing to connect two actions?",
            current_item=_item("en08", type_="transformation",
                               instruction="Combine using a participle clause.",
                               prompt="He opened the window. He sat down at his desk."),
            expected_note_id="en_participle_clause_combination",
            description="'-ing to connect actions' → participle clause note.",
            bucket="clause_combination",
        ),
        FreeformEvalCase(
            case_id="freeform_clause_003",
            question="How do I add a 'which' clause to give extra information about something?",
            current_item=_item("en_nr1", type_="transformation",
                               instruction="Add a non-restrictive relative clause.",
                               prompt="The conference was very productive. It was held in London.",
                               answer="The conference, which was held in London, was very productive."),
            expected_note_id="en_non_restrictive_relative_clause",
            description="'which clause for extra info' → non-restrictive relative clause note.",
            bucket="clause_combination",
        ),
        FreeformEvalCase(
            case_id="freeform_clause_004",
            question="What does it mean to identify a specific person or thing in a sentence using a clause?",
            current_item=_item("en09", type_="transformation",
                               instruction="Combine using a relative clause.",
                               prompt="The scientist made the discovery. She won the award."),
            expected_note_id="en_relative_clause_combination",
            description="Identifying referents via clause → relative clause note.",
            bucket="clause_combination",
        ),

        # ── phrase_rephrasing ──────────────────────────────────────────────────
        FreeformEvalCase(
            case_id="freeform_phrase_001",
            question="How do I say this workplace phrase in a more professional way?",
            current_item=_item("en_wp1", topic="work", type_="substitution", category="phrase",
                               instruction="Rephrase as a formal business phrase.",
                               prompt="touch base with the team",
                               answer="consult with the team"),
            expected_note_id="en_work_phrase_formal",
            description="'professional way to say workplace phrase' → work phrase formal note.",
            bucket="phrase_rephrasing",
        ),
        FreeformEvalCase(
            case_id="freeform_phrase_002",
            question="What's the formal sports journalism way to describe this play?",
            current_item=_item("en_sp2", topic="sport", type_="substitution", category="phrase",
                               instruction="Rephrase using sports journalism language.",
                               prompt="scored a great goal",
                               answer="converted a precise finish"),
            expected_note_id="en_sport_phrase_formal",
            description="Sports journalism phrasing question → sport phrase formal note.",
            bucket="phrase_rephrasing",
        ),
        FreeformEvalCase(
            case_id="freeform_phrase_003",
            question="How would a doctor or nurse say this instead of everyday language?",
            current_item=_item("en_he1", topic="health", type_="substitution", category="phrase",
                               instruction="Rephrase using clinical language.",
                               prompt="is getting better",
                               answer="is showing signs of recovery"),
            expected_note_id="en_health_phrase_formal",
            description="Clinical phrasing question → health phrase formal note.",
            bucket="phrase_rephrasing",
        ),
        FreeformEvalCase(
            case_id="freeform_phrase_004",
            question="How would a financial analyst phrase this in a report?",
            current_item=_item("en_fi1", topic="finance", type_="substitution", category="phrase",
                               instruction="Rephrase using financial report language.",
                               prompt="money went up a lot",
                               answer="revenue increased significantly"),
            expected_note_id="en_finance_phrase_formal",
            description="Financial analyst phrasing question → finance phrase formal note.",
            bucket="phrase_rephrasing",
        ),

        # ── domain_register ────────────────────────────────────────────────────
        FreeformEvalCase(
            case_id="freeform_domain_001",
            question="What's the precise sports term for this instead of a general description?",
            current_item=_item("en_s1", topic="sport", category="vocab", type_="substitution",
                               instruction="Replace with the precise sports term.",
                               prompt="kick the ball into the goal"),
            expected_note_id="en_sport_vocabulary_precision",
            description="'precise sport term' freeform → sport vocab precision note.",
            bucket="domain_register",
        ),
        FreeformEvalCase(
            case_id="freeform_domain_002",
            question="How do programmers or engineers describe this concept technically?",
            current_item=_item("en_t1", topic="tech", category="vocab", type_="substitution",
                               instruction="Replace with the precise technical term.",
                               prompt="the program crashed"),
            expected_note_id="en_tech_vocabulary_precision",
            description="'technical engineer term' freeform → tech vocab precision note.",
            bucket="domain_register",
        ),
        FreeformEvalCase(
            case_id="freeform_domain_003",
            question="What vocabulary would make this sound more academic or scholarly?",
            current_item=_item("en_ed1", topic="education", category="vocab", type_="substitution",
                               instruction="Give the advanced academic term.",
                               prompt="test (noun, academic)", answer="assessment"),
            expected_note_id="en_general_vocabulary_precision",
            description="'academic vocabulary' freeform → general vocab precision note (authoring match).",
            bucket="domain_register",
        ),
        FreeformEvalCase(
            case_id="freeform_domain_004",
            question="How do you describe this in proper scientific language?",
            current_item=_item("en_sc1", topic="daily", category="sentence", type_="transformation",
                               instruction="Rewrite using scientific language.",
                               prompt="The air got much hotter near the fire."),
            expected_note_id="en_science_formal_register",
            description="'scientific language' freeform → science formal register note.",
            bucket="domain_register",
        ),

        # ── no_hit_freeform ────────────────────────────────────────────────────
        FreeformEvalCase(
            case_id="freeform_no_hit_001",
            question="What is the capital of France?",
            current_item=_item("en_misc_01", instruction="Translate to English.", prompt="La capital de Francia"),
            expected_note_id=None,
            description="Off-topic geography question should not retrieve any contrast note.",
            bucket="no_hit_freeform",
        ),
        FreeformEvalCase(
            case_id="freeform_no_hit_002",
            question="How many irregular verbs are there in English?",
            current_item=_item("en_misc_02", instruction="Conjugate in past tense.", prompt="go"),
            expected_note_id=None,
            description="Grammar trivia question should not retrieve any contrast note.",
            bucket="no_hit_freeform",
        ),
        FreeformEvalCase(
            case_id="freeform_no_hit_003",
            question="Can you give me a fun fact about language?",
            current_item=_item("en_misc_03", instruction="Translate.", prompt="hello"),
            expected_note_id=None,
            description="Off-topic fun fact request should not retrieve any contrast note.",
            bucket="no_hit_freeform",
        ),
    ]
