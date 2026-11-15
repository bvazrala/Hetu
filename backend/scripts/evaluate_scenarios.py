"""Run the acceptance scenarios against the configured model.

This makes real, billed model calls: about 11 conversation turns, each of
which is two or more model calls. Run it from the backend directory:

    uv run python -m scripts.evaluate_scenarios
    uv run python -m scripts.evaluate_scenarios --only A

Each scenario prints what Hetu decided and what it said, then a few
automatic checks on the routing. The checks cannot judge whether an
explanation is good teaching. Read the replies yourself.
"""

import argparse
import asyncio
import logging
import time

PROOF = "Prove that if n² is even, then n is even. My attempt: Assume n² = 2k. Then n = √(2k), so n is even."

TEACHING = {"teach", "explain", "demonstrate"}

# Each scenario is a list of student turns and one check per turn. A check
# receives the response and returns a list of (description, passed) pairs.
SCENARIOS = {
    "A": {
        "title": "Foundational confusion",
        "turns": [
            "I don't understand object-oriented programming. I've heard of classes, inheritance, and "
            "polymorphism but I have no idea how they work."
        ],
        "checks": [
            lambda r: [
                ("answered by the programming specialist", r.specialists[:1] == ["programming"]),
                ("chose to teach or explain", r.action in TEACHING),
                ("did not treat it as an argument to inspect", r.inspection is None),
                ("included a code example", "```" in r.reply),
            ]
        ],
    },
    "B": {
        "title": "Mathematical reasoning",
        "turns": [PROOF],
        "checks": [
            lambda r: [
                ("ran the proof inspection", r.inspection is not None),
                ("found a step to question", bool(r.inspection and r.inspection.analysis.observations)),
                ("answered by the mathematics specialist", r.specialists[:1] == ["mathematics"]),
            ]
        ],
    },
    "C": {
        "title": "Logical fallacy",
        "turns": [
            "Everyone I know who studies with music gets better grades, so studying with music makes "
            "everyone perform better."
        ],
        "checks": [
            lambda r: [
                ("answered by the logic specialist", r.specialists[:1] == ["logic"]),
                ("chose to question the claim", r.action in {"challenge_assumption", "correct_misconception"}),
                ("did not run the proof inspection", r.inspection is None),
            ]
        ],
    },
    "D": {
        "title": "Science",
        "turns": ["Why does the sky look blue? I don't understand how light scattering works."],
        "checks": [
            lambda r: [
                ("answered by the science specialist", r.specialists[:1] == ["science"]),
                ("chose to teach or explain", r.action in TEACHING),
                ("did not treat it as an argument to inspect", r.inspection is None),
                ("explained scattering", "scatter" in r.reply.lower()),
            ]
        ],
    },
    "E": {
        "title": "Writing and history",
        "turns": [
            "I'm writing about whether the Industrial Revolution improved people's lives. I think it did, "
            "but I'm not sure how to support that."
        ],
        "checks": [
            lambda r: [
                ("answered by the humanities specialist", r.specialists[:1] == ["humanities"]),
                ("did not run the proof inspection", r.inspection is None),
            ]
        ],
    },
    "F": {
        "title": "Adaptive conversation",
        "turns": [
            "Can you explain what a derivative is? I've never taken calculus.",
            "Oh, so for x² the derivative is 2x because you bring the 2 down in front?",
            "Then the derivative of x³ should be 3x, right?",
            "Okay. Can I try one? I think the derivative of x⁴ is 4x³.",
        ],
        "checks": [
            lambda r: [("chose to teach or explain", r.action in TEACHING), ("mathematics", r.specialists[:1] == ["mathematics"])],
            lambda r: [("stayed with mathematics", r.specialists[:1] == ["mathematics"])],
            lambda r: [("addressed the mistake", r.action in {"correct_misconception", "explain", "challenge_assumption"})],
            lambda r: [
                ("did not correct a right answer", r.action != "correct_misconception"),
                ("kept notes on the topic", bool(r.learning_state.topic)),
            ],
        ],
    },
    "G": {
        "title": "Challenging the AI",
        "turns": [
            PROOF,
            "I disagree. If n were odd then n² would be odd, but n² is even, so n has to be even. My step is fine.",
        ],
        "checks": [
            lambda r: [("found a step to question", bool(r.inspection and r.inspection.analysis.observations))],
            lambda r: [
                ("chose to reconsider", r.action == "reconsider"),
                ("re-ran the inspection with the student's reason", bool(r.inspection and r.inspection.analysis.challenge)),
            ],
        ],
    },
}


def proof_context(response):
    """The open question from an inspection, as the frontend would send it back."""
    from app.schemas import ProofContext

    inspection = response.inspection if response else None
    if not inspection or not inspection.analysis.observations:
        return None
    observation = inspection.analysis.observations[0]
    step = next(node for node in inspection.analysis.nodes if node.id == observation.target)
    return ProofContext(problem=inspection.problem, draft=inspection.draft, step_text=step.text, question=observation.question)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--only", help="Run one scenario, for example A.")
    args = parser.parse_args()

    from app.config import get_settings
    from app.llm import InferenceNotConfigured
    from app.schemas import ChatMessage, ChatRequest
    from app.tutor import build_tutor

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("      [%(message)s]"))
    logging.getLogger("hetu").addHandler(handler)
    logging.getLogger("hetu").setLevel(logging.INFO)

    settings = get_settings()
    try:
        tutor = build_tutor(settings)
    except InferenceNotConfigured as error:
        print(error)
        return 2
    print(f"Model: {settings.llm_provider}:{settings.llm_model}\n")

    passed = total = 0
    for key, scenario in SCENARIOS.items():
        if args.only and args.only.upper() != key:
            continue
        print(f"Scenario {key}: {scenario['title']}")
        messages, notes, context = [], None, None
        for turn, check in zip(scenario["turns"], scenario["checks"], strict=True):
            messages.append(ChatMessage(role="student", content=turn))
            print(f"\n  Student: {turn}")
            started = time.perf_counter()
            try:
                request = ChatRequest(messages=messages[-24:], learning_state=notes, proof_context=context)
                response = await asyncio.wait_for(tutor(request), timeout=settings.analyze_timeout_seconds)
            except Exception as error:
                print(f"  ERROR after {time.perf_counter() - started:.1f}s  {type(error).__name__}: {str(error)[:300]}")
                total += 1
                break
            seconds = time.perf_counter() - started
            who = ", ".join(response.specialists) or "coach"
            print(f"  Hetu ({response.action}; {who}; {seconds:.1f}s):")
            for line in response.reply.splitlines():
                print(f"    {line}")
            for tool_check in response.checks:
                print(f"    [{tool_check.tool}: {tool_check.result}]")
            if response.inspection:
                analysis = response.inspection.analysis
                outcome = f", challenge {analysis.challenge.outcome}" if analysis.challenge else ""
                print(f"    [inspection: {len(analysis.nodes)} steps, {len(analysis.observations)} question(s){outcome}]")
            for description, ok in check(response):
                total += 1
                passed += ok
                print(f"    {'PASS' if ok else 'FAIL'}  {description}")
            messages.append(ChatMessage(role="hetu", content=response.reply[:6000]))
            notes = response.learning_state
            context = proof_context(response) or context
        print()

    print(f"{passed} of {total} routing checks passed. Read the replies to judge the teaching.")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
