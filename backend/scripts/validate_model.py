"""Run the seed examples through the configured model and report the results.

This makes real, billed model calls. Run it from the backend directory:

    uv run python -m scripts.validate_model
    uv run python -m scripts.validate_model --model openai/gpt-oss-120b --runs 3
    uv run python -m scripts.validate_model --workflow direct
    uv run python -m scripts.validate_model --challenges

An example passes when the workflow agrees with the fixture on the basic
question: does this draft have a gap? Read the questions yourself as well.
A run can pass and still ask a poor question.

`--challenges` runs three scripted disagreements instead of the examples and
checks whether the workflow withdraws or keeps its question as expected.
"""

import argparse
import asyncio
import json
import logging
import os
import time
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[2] / "examples" / "sample_proofs.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--provider", help="Overrides HETU_LLM_PROVIDER for this run.")
    parser.add_argument("--model", help="Overrides HETU_LLM_MODEL for this run.")
    parser.add_argument("--workflow", choices=["deep_agent", "direct"], help="Overrides HETU_WORKFLOW.")
    parser.add_argument("--temperature", help="Overrides HETU_LLM_TEMPERATURE.")
    parser.add_argument("--runs", type=int, default=1, help="Times to run each example. Default 1.")
    parser.add_argument("--only", help="Run only examples whose id contains this text.")
    parser.add_argument("--challenges", action="store_true", help="Run the scripted challenges instead.")
    parser.add_argument("--pause", type=float, default=0.0, help="Seconds to wait between calls, for rate limits.")
    return parser.parse_args()


# Each case disputes a question about one step. The first is a fair objection
# to an over-strict question. The other two leave the draft's gap in place.
CHALLENGE_CASES = [
    {
        "name": "fair objection to a routine step",
        "example": "even-sum-correct",
        "step_text": "Since m + n is an integer, a + b is even.",
        "question": "Why is 2(m + n) even?",
        "reason": "An integer of the form 2 times an integer is even by definition, and m + n is an integer.",
        "expected": "withdrawn",
    },
    {
        "name": "objection that does not address the gap",
        "example": "parity-square-incomplete",
        "step_text": "so n must be even.",
        "question": "Why does n = √(2k) imply that n is even?",
        "reason": "It is obvious. The square root of an even number is always even.",
        "expected": "maintained",
    },
    {
        "name": "objection that supplies the idea missing from the draft",
        "example": "parity-square-incomplete",
        "step_text": "so n must be even.",
        "question": "Why does n = √(2k) imply that n is even?",
        "reason": "If n were odd then n² would be odd. But n² is even, so n has to be even.",
        "expected": "maintained",
    },
]


async def run_challenges(analyze, examples, timeout: float) -> int:
    from app.schemas import Challenge

    by_id = {example["id"]: example for example in examples}
    passed = 0
    for case in CHALLENGE_CASES:
        example = by_id[case["example"]]
        challenge = Challenge(step_text=case["step_text"], question=case["question"], reason=case["reason"])
        print(f"{case['name']}  (expected: {case['expected']})")
        try:
            analysis = await asyncio.wait_for(analyze(example["problem"], example["draft"], challenge), timeout=timeout)
        except Exception as error:
            print(f"  ERROR  {type(error).__name__}: {str(error)[:400]}\n")
            continue
        outcome = analysis.challenge.outcome
        ok = outcome == case["expected"]
        passed += ok
        print(f"  {'PASS' if ok else 'FAIL'}  {outcome}")
        print(f"         response: {analysis.challenge.response}\n")
    print(f"{passed} of {len(CHALLENGE_CASES)} challenges answered as expected.")
    return 0 if passed == len(CHALLENGE_CASES) else 1


def describe(analysis) -> str:
    if not analysis.observations:
        return "no gap"
    observation = analysis.observations[0]
    step = observation.target.removeprefix("n")
    return f"{observation.issue_type} at step {step} of {len(analysis.nodes)}"


async def main() -> int:
    args = parse_args()
    # Overrides must be in the environment before the settings are read.
    overrides = [
        ("LLM_PROVIDER", args.provider),
        ("LLM_MODEL", args.model),
        ("WORKFLOW", args.workflow),
        ("LLM_TEMPERATURE", args.temperature),
    ]
    for name, value in overrides:
        if value:
            os.environ[f"HETU_{name}"] = value

    from langchain_core.callbacks import get_usage_metadata_callback

    from app.agents import build_analyzer
    from app.config import get_settings
    from app.llm import InferenceNotConfigured

    # Show the workflow's own notes: critic verdicts and retries.
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("         [%(message)s]"))
    logging.getLogger("hetu").addHandler(handler)
    logging.getLogger("hetu").setLevel(logging.INFO)

    settings = get_settings()
    try:
        analyze = build_analyzer(settings)
    except InferenceNotConfigured as error:
        print(error)
        return 2

    print(
        f"Model: {settings.llm_provider}:{settings.llm_model}   "
        f"Workflow: {settings.workflow}   Temperature: {settings.llm_temperature}\n"
    )
    examples = json.loads(FIXTURE.read_text(encoding="utf-8"))["examples"]
    if args.challenges:
        return await run_challenges(analyze, examples, settings.analyze_timeout_seconds)
    if args.only:
        examples = [example for example in examples if args.only in example["id"]]
    passed = total = errors = 0
    seconds_taken: list[float] = []

    for example in examples:
        print(f"{example['id']}  (expected: {example['expected']})")
        for run in range(1, args.runs + 1):
            total += 1
            started = time.perf_counter()
            try:
                with get_usage_metadata_callback() as usage:
                    analysis = await asyncio.wait_for(
                        analyze(example["problem"], example["draft"]),
                        timeout=settings.analyze_timeout_seconds,
                    )
            except Exception as error:  # Report every failure; this is a diagnostic tool.
                seconds = time.perf_counter() - started
                errors += 1
                print(f"  run {run}: ERROR after {seconds:.1f}s  {type(error).__name__}: {str(error)[:400]}")
                continue
            seconds = time.perf_counter() - started
            seconds_taken.append(seconds)

            found_gap = bool(analysis.observations)
            ok = found_gap == (example["expected"] != "correct")
            passed += ok
            tokens_in = sum(u.get("input_tokens", 0) for u in usage.usage_metadata.values())
            tokens_out = sum(u.get("output_tokens", 0) for u in usage.usage_metadata.values())
            unmatched = sum(node.span is None for node in analysis.nodes)

            tokens = f"tokens in/out {tokens_in}/{tokens_out}" if tokens_in else "tokens not reported"
            print(f"  run {run}: {'PASS' if ok else 'FAIL'}  {describe(analysis)}  {seconds:.1f}s  {tokens}")
            if unmatched:
                print(f"         {unmatched} step(s) were not quoted exactly from the draft")
            if found_gap:
                question = analysis.observations[0].question
                if "\\" in question and "$" not in question:
                    print("         note: the question has LaTeX without dollar signs")
                print(f"         question: {question}")
                if analysis.observations[0].hint:
                    print(f"         hint: {analysis.observations[0].hint}")
            if args.pause:
                await asyncio.sleep(args.pause)
        print()

    print(f"{passed} of {total} runs passed. {errors} ended in an error.")
    if seconds_taken:
        print(f"Slowest run: {max(seconds_taken):.1f}s. Average: {sum(seconds_taken) / len(seconds_taken):.1f}s.")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
