"""
Curated subset of real English drill items used by the synthetic evalset.

Each entry mirrors the data the planner agent sees per result:
    item_id, topic, category, type, instruction, prompt, expected_answer

The IDs MUST exist in the canonical taxonomy (planner/taxonomy.py); the
validator's phantom-id check is enforced against the history we generate.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EvalItem:
    item_id: str
    topic: str
    category: str
    type: str
    instruction: str
    prompt: str
    expected_answer: str


# Hand-picked across all 8 taxonomy labels, real ids.
EVAL_ITEMS: dict[str, EvalItem] = {
    # formal_register / advanced_synonym (work, daily — sentence)
    "en03": EvalItem("en03", "daily", "sentence", "substitution",
                    "Replace the bracketed word with a more formal synonym.",
                    "We need to [get] approval first.", "obtain"),
    "en05": EvalItem("en05", "daily", "sentence", "substitution",
                    "Replace the bracketed word with a more formal synonym.",
                    "Can you [help] me with this task?", "assist"),
    "en07": EvalItem("en07", "work", "sentence", "substitution",
                    "Replace the bracketed phrase with a single precise verb.",
                    "He [talked about] the risks at length.", "addressed"),
    "en09": EvalItem("en09", "work", "sentence", "transformation",
                    "Rewrite in formal register.",
                    "I think you should probably reconsider this.",
                    "I would recommend reconsidering this course of action."),
    "en12": EvalItem("en12", "work", "sentence", "transformation",
                    "Rewrite in formal register.",
                    "We can't do this because we don't have enough money.",
                    "This is not feasible due to insufficient funding."),
    "en14": EvalItem("en14", "daily", "sentence", "transformation",
                    "Rewrite more concisely in formal style.",
                    "Due to the fact that the deadline was missed, we lost the contract.",
                    "Because the deadline was missed, the contract was lost."),
    "en16": EvalItem("en16", "work", "sentence", "translation",
                    "Express this casually-worded idea in formal English.",
                    "He's really good at his job.",
                    "He demonstrates exceptional professional competence."),
    "en17": EvalItem("en17", "work", "sentence", "translation",
                    "Express formally.",
                    "We messed up the launch.",
                    "The launch was executed with significant deficiencies."),
    "en18": EvalItem("en18", "daily", "sentence", "translation",
                    "Paraphrase in academic style.",
                    "Everyone knows this doesn't work.",
                    "It is widely acknowledged that this approach is ineffective."),
    "en20": EvalItem("en20", "work", "sentence", "translation",
                    "Express this casually-worded idea in formal English.",
                    "She basically runs the whole company.",
                    "She effectively oversees the entire organization."),

    # passive_voice / complex_sentence_combination
    "en10": EvalItem("en10", "work", "sentence", "transformation",
                    "Transform to passive voice.",
                    "The committee reviewed the proposal.",
                    "The proposal was reviewed by the committee."),
    "en11": EvalItem("en11", "daily", "sentence", "transformation",
                    "Combine into one complex sentence using a participle.",
                    "She studied the data. She reached a conclusion.",
                    "Having studied the data, she reached a conclusion."),
    "en13": EvalItem("en13", "daily", "sentence", "transformation",
                    "Combine using a relative clause.",
                    "The manager approved the budget. She leads the project.",
                    "The manager who leads the project approved the budget."),
    "en15": EvalItem("en15", "daily", "sentence", "transformation",
                    "Transform to active voice.",
                    "Mistakes were made by the team during the rollout.",
                    "The team made mistakes during the rollout."),

    # vocab — daily
    "en_v1":  EvalItem("en_v1",  "daily", "vocab", "substitution", "Give the advanced synonym.", "start (verb)",   "initiate"),
    "en_v2":  EvalItem("en_v2",  "daily", "vocab", "substitution", "Give the advanced synonym.", "end (verb)",     "conclude"),
    "en_v6":  EvalItem("en_v6",  "daily", "vocab", "substitution", "Give the advanced synonym.", "change (verb)",  "modify"),
    "en_v7":  EvalItem("en_v7",  "daily", "vocab", "substitution", "Give the advanced synonym.", "look at (verb)", "examine"),
    "en_v9":  EvalItem("en_v9",  "daily", "vocab", "substitution", "Give the advanced synonym.", "wrong (adj)",    "erroneous"),
    "en_v10": EvalItem("en_v10", "daily", "vocab", "substitution", "Give the advanced synonym.", "important (adj)", "paramount"),

    # vocab — work
    "en_v4":  EvalItem("en_v4",  "work", "vocab", "substitution", "Give the advanced synonym.", "tell (verb)",  "inform"),
    "en_v5":  EvalItem("en_v5",  "work", "vocab", "substitution", "Give the advanced synonym.", "need (verb)",  "require"),
    "en_v11": EvalItem("en_v11", "work", "vocab", "substitution", "Give the advanced synonym.", "fair (adj)",   "equitable"),
    "en_v14": EvalItem("en_v14", "work", "vocab", "substitution", "Give the advanced synonym.", "agree (verb)", "concur"),

    # phrase — work / daily (formal)
    "en_p1":  EvalItem("en_p1",  "work",  "phrase", "translation",
                       "Express formally.", "Let's talk about this later.",
                       "I suggest we revisit this matter at a later time."),
    "en_p2":  EvalItem("en_p2",  "work",  "phrase", "translation",
                       "Express this casually-worded phrase in formal English.",
                       "Can you look into that?", "Could you investigate that matter?"),
    "en_p4":  EvalItem("en_p4",  "work",  "phrase", "translation",
                       "Rephrase using formal language.", "That's a great idea.",
                       "That is an excellent proposition."),
    "en_p5":  EvalItem("en_p5",  "daily", "phrase", "translation",
                       "Express formally.", "I'll get back to you.",
                       "I will follow up with you shortly."),
    "en_p10": EvalItem("en_p10", "work",  "phrase", "translation",
                       "Rephrase using formal language.", "The boss wants this done ASAP.",
                       "The matter requires immediate attention per management."),

    # work-topic specifics
    "en_w1":  EvalItem("en_w1",  "work", "sentence", "substitution",
                       "Replace the bracketed phrase with a professional term.",
                       "I [quit] the project.", "withdrew from"),
    "en_w3":  EvalItem("en_w3",  "work", "sentence", "transformation",
                       "Rewrite in formal business language.",
                       "We didn't hit our targets this quarter.",
                       "We fell short of our projected targets this quarter."),
    "en_w5":  EvalItem("en_w5",  "work", "vocab", "substitution",
                       "Give the advanced business synonym.", "meeting (noun)", "consultation"),
    "en_w8":  EvalItem("en_w8",  "work", "phrase", "translation",
                       "Express in formal business language.", "We're losing money.",
                       "The organization is experiencing a revenue deficit."),

    # money / health / sport (cross-topic ballast)
    "en_mo1": EvalItem("en_mo1", "money",  "vocab",    "substitution", "Give the advanced financial term.", "money coming in (noun)", "revenue"),
    "en_mo7": EvalItem("en_mo7", "money",  "sentence", "transformation", "Rewrite in formal financial language.", "We lost a lot of money this year.", "The organization reported substantial financial losses this fiscal year."),
    "en_he2": EvalItem("en_he2", "health", "vocab",    "substitution", "Give the advanced synonym.", "get better (verb)", "recover"),
    "en_sp3": EvalItem("en_sp3", "sport",  "sentence", "substitution", "Replace the bracketed word with a more precise synonym.", "The team had a [big] win.", "decisive"),
    "en_sp1": EvalItem("en_sp1", "sport",  "sentence", "substitution", "Replace the bracketed phrase with a single precise verb.", "The player [did well] in the match.", "excelled"),

    # food / tech (mixed-bag fillers)
    "en_f1":  EvalItem("en_f1",  "food",  "vocab",    "substitution", "Give the advanced culinary term.", "tasty (adj)", "delectable"),
    "en_t1":  EvalItem("en_t1",  "tech",  "sentence", "substitution", "Replace the bracketed word with a precise technical term.", "The app [crashed].", "failed"),
}


def items_by_topic(topic: str) -> list[EvalItem]:
    return [it for it in EVAL_ITEMS.values() if it.topic == topic]


def items_by_category(category: str) -> list[EvalItem]:
    return [it for it in EVAL_ITEMS.values() if it.category == category]


def items_by_type(type_: str) -> list[EvalItem]:
    return [it for it in EVAL_ITEMS.values() if it.type == type_]
