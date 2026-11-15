"""Tests for the learning system. Every model reply is scripted; nothing calls a provider.

These check that the application does the right thing with a given plan.
They cannot show that a real model writes a good plan or a good explanation.
"""

import asyncio
import json

import pytest
from deepagents import register_harness_profile
from langchain_core.messages import AIMessage

from app.agents import HARNESS_PROFILE, DraftAnalysis, to_analysis
from app.config import Settings
from app.llm import build_chat_model, model_spec
from app.schemas import ChatMessage, ChatRequest, LearningState, ProofContext, WorkspaceContext
from app.tutor import SPECIALIST_PROMPTS, TEACHING_PRINCIPLES, LearningSystem
from tests.fakes import tool_call

OOP = "I don't understand object-oriented programming. I've heard of classes and inheritance but have no idea how they work."
PROOF_MESSAGE = "Prove that if n² is even, then n is even. My attempt: Assume n² = 2k. Then n = √(2k), so n is even."
ATTEMPT = "Assume n² = 2k. Then n = √(2k), so n is even."
STEPS = [
    {"type": "assumption", "text": "Assume n² = 2k.", "relies_on": []},
    {"type": "conclusion", "text": "Then n = √(2k), so n is even.", "relies_on": [1]},
]
GAP = {"step": 2, "issue_type": "unjustified_step", "question": "Why does $n = \\sqrt{2k}$ make $n$ even?", "hint": None}


def plan(**fields) -> AIMessage:
    """A scripted coach plan, as the model would return it."""
    base = {"need": "asks_question", "action": "explain", "lead": "coach", "brief": "", "learning_state": {}}
    return AIMessage(content=json.dumps({**base, **fields}))


def said(*contents: str, notes: LearningState | None = None, **extra) -> ChatRequest:
    """A conversation that alternates student, hetu, student, and ends with the student."""
    roles = ["student", "hetu"]
    messages = [ChatMessage(role=roles[i % 2], content=text) for i, text in enumerate(contents)]
    return ChatRequest(messages=messages, learning_state=notes, **extra)


class RecordingAnalyzer:
    """Stands in for the proof inspection and remembers how it was called."""

    def __init__(self, gap=GAP, fail=False):
        self.calls = []
        self.gap = gap
        self.fail = fail

    async def __call__(self, problem, draft, challenge=None):
        self.calls.append((problem, draft, challenge))
        if self.fail:
            raise RuntimeError("inspection is down")
        steps = [{"type": "claim", "text": draft, "relies_on": []}] if draft != ATTEMPT else STEPS
        gap = self.gap if draft == ATTEMPT else None
        return to_analysis(draft, DraftAnalysis(steps=steps, gap=gap), challenge)


@pytest.fixture
def hetu(groq_requests):
    """A learning system on the real Groq client class, with the network call replaced."""
    captured, replies = groq_requests
    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-120b")
    register_harness_profile(model_spec(settings), HARNESS_PROFILE)
    analyzer = RecordingAnalyzer()
    system = LearningSystem(build_chat_model(settings), analyzer)

    def run(request: ChatRequest):
        return asyncio.run(system.respond(request))

    return run, captured, replies, analyzer


def system_prompt(call) -> str:
    return call["messages"][0].content


def tool_names(call) -> set[str]:
    return {tool["function"]["name"] for tool in call.get("tools", [])}


# Scenario A: a student who lacks the foundation is taught, not questioned.


def test_foundational_confusion_goes_to_the_programming_specialist_to_teach(hetu):
    run, captured, replies, analyzer = hetu
    replies.append(
        plan(
            need="lacks_foundation",
            action="teach",
            lead="programming",
            level="beginner",
            brief="Teach classes and objects from scratch with one small Python example.",
            learning_state={"topic": "object-oriented programming", "concepts": ["classes"]},
        )
    )
    replies.append(AIMessage(content="A class is a blueprint.\n\n```python\nclass Dog:\n    pass\n```"))

    response = run(said(OOP))

    assert response.action == "teach"
    assert response.specialists == ["programming"]
    assert response.reply.startswith("A class is a blueprint.")
    assert response.learning_state.topic == "object-oriented programming"
    assert response.inspection is None
    assert analyzer.calls == []

    responder = captured[1]
    assert system_prompt(responder) == SPECIALIST_PROMPTS["programming"] + "\n" + TEACHING_PRINCIPLES
    final = responder["messages"][-1].content
    assert "Teach classes and objects from scratch" in final
    assert "The student's need: lacks_foundation. What to do: teach. Apparent level: beginner." in final
    assert f"<student_message>\n{OOP}\n</student_message>" in final
    # A specialist with no tools is a single plain model call.
    assert tool_names(responder) == set()
    assert len(captured) == 2


def test_the_coach_is_told_never_to_question_a_student_who_lacks_the_basics(hetu):
    run, captured, replies, _ = hetu
    replies += [plan(), AIMessage(content="Hello.")]
    run(said("hi"))
    assert "Never ask them to explain what they just said they do not know." in system_prompt(captured[0])
    assert "Do not end every reply with a question." in TEACHING_PRINCIPLES


# Scenario F: the conversation is remembered and the strategy can change.


def test_earlier_turns_and_session_notes_reach_both_stages(hetu):
    run, captured, replies, _ = hetu
    replies += [plan(lead="programming", action="demonstrate"), AIMessage(content="Here is an example.")]
    notes = LearningState(topic="classes", understood=["a class groups data and behaviour"])

    response = run(said("I don't understand classes.", "A class is a blueprint.", "How is that different from a function?", notes=notes))

    planner, responder = captured
    assert [m.content for m in planner["messages"][1:3]] == ["I don't understand classes.", "A class is a blueprint."]
    assert "Shown by the student: a class groups data and behaviour" in planner["messages"][-1].content
    assert [m.type for m in responder["messages"]] == ["system", "human", "ai", "human"]
    assert responder["messages"][2].content == "A class is a blueprint."
    assert response.action == "demonstrate"


def test_the_strategy_follows_the_plan_from_turn_to_turn(hetu):
    run, _, replies, _ = hetu
    replies += [plan(lead="science", action="explain"), AIMessage(content="Light scatters.")]
    replies += [plan(lead="science", action="correct_misconception", need="has_misconception"), AIMessage(content="Not quite.")]

    first = run(said("Why is the sky blue?"))
    second = run(said("Why is the sky blue?", first.reply, "So the sky reflects the ocean?"))

    assert (first.action, second.action) == ("explain", "correct_misconception")


# Scenario B: a written proof is inspected and the graph data comes back.


def test_a_proof_in_a_message_is_inspected_and_discussed_by_the_mathematics_specialist(hetu):
    run, captured, replies, analyzer = hetu
    replies.append(
        plan(
            need="shares_reasoning",
            action="inspect_reasoning",
            lead="mathematics",
            inspect_argument=True,
            proof_problem="Prove that if n² is even, then n is even.",
            proof_attempt=ATTEMPT,
        )
    )
    replies.append(AIMessage(content="Look at the step \"so n is even\"."))

    response = run(said(PROOF_MESSAGE))

    assert analyzer.calls == [("Prove that if n² is even, then n is even.", ATTEMPT, None)]
    assert response.action == "inspect_reasoning"
    assert response.specialists == ["mathematics"]
    assert response.inspection.draft == ATTEMPT
    assert response.inspection.analysis.observations[0].target == "n2"

    responder = captured[1]
    assert "<inspection>" in responder["messages"][-1].content
    assert "Question about step 2 (unjustified_step)" in responder["messages"][-1].content
    assert tool_names(responder) == {"find_counterexample", "check_identity"}


def test_an_inspected_proof_is_always_handled_by_mathematics(hetu):
    run, captured, replies, _ = hetu
    replies += [plan(lead="logic", inspect_argument=True, proof_attempt=ATTEMPT), AIMessage(content="Feedback.")]
    response = run(said(PROOF_MESSAGE))
    assert response.specialists == ["mathematics"]
    assert system_prompt(captured[1]).startswith(SPECIALIST_PROMPTS["mathematics"])


def test_a_reworded_copy_of_the_proof_is_not_trusted(hetu):
    run, _, replies, analyzer = hetu
    replies += [
        plan(lead="mathematics", inspect_argument=True, proof_attempt="Suppose n squared is 2k, hence n is even."),
        AIMessage(content="Feedback."),
    ]
    response = run(said(PROOF_MESSAGE))
    # The model's copy does not match what the student wrote, so the student's own message is inspected.
    assert analyzer.calls[0][1] == PROOF_MESSAGE
    assert response.inspection.draft == PROOF_MESSAGE


def test_a_shared_workspace_draft_is_what_gets_inspected(hetu):
    run, captured, replies, analyzer = hetu
    replies += [plan(lead="mathematics", inspect_argument=True), AIMessage(content="Feedback.")]
    workspace = WorkspaceContext(problem="Prove it.", draft=ATTEMPT)

    run(said("Can you look at my work?", workspace=workspace))

    assert analyzer.calls == [("Prove it.", ATTEMPT, None)]
    assert f"<workspace>\nProblem: Prove it.\n\n{ATTEMPT}\n</workspace>" in captured[1]["messages"][-1].content


def test_an_explanation_request_never_triggers_an_inspection(hetu):
    run, _, replies, analyzer = hetu
    replies += [plan(lead="science", action="explain"), AIMessage(content="Rayleigh scattering.")]
    response = run(said("Why does the sky look blue? I don't understand how light scattering works."))
    assert analyzer.calls == []
    assert response.inspection is None


def test_a_failed_inspection_still_gets_the_student_an_answer(groq_requests):
    captured, replies = groq_requests
    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-120b")
    system = LearningSystem(build_chat_model(settings), RecordingAnalyzer(fail=True))
    replies += [plan(lead="mathematics", inspect_argument=True, proof_attempt=ATTEMPT), AIMessage(content="My own reading.")]

    response = asyncio.run(system.respond(said(PROOF_MESSAGE)))

    assert response.reply == "My own reading."
    assert response.inspection is None
    assert "inspection is not available for this turn" in captured[1]["messages"][-1].content


# Scenario G: the student can challenge Hetu's feedback.

CONTEXT = ProofContext(problem="Prove it.", draft=ATTEMPT, step_text="Then n = √(2k), so n is even.", question="Why?")


def test_a_disagreement_about_a_proof_is_reconsidered_with_the_students_reason(hetu):
    run, captured, replies, analyzer = hetu
    replies += [
        plan(need="disagrees", action="reconsider", lead="mathematics", challenge_reason="The root of an even square is even."),
        AIMessage(content="I looked again."),
    ]

    response = run(said(PROOF_MESSAGE, "Why does that follow?", "I think that step is fine.", proof_context=CONTEXT))

    problem, draft, challenge = analyzer.calls[0]
    assert (problem, draft) == ("Prove it.", ATTEMPT)
    assert challenge.reason == "The root of an even square is even."
    assert challenge.step_text == CONTEXT.step_text
    assert response.action == "reconsider"
    assert response.inspection.analysis.challenge.outcome == "maintained"
    assert "The student challenged the earlier question. Outcome: maintained." in captured[1]["messages"][-1].content


def test_a_disagreement_outside_a_proof_is_reconsidered_by_the_specialist(hetu):
    run, captured, replies, analyzer = hetu
    replies += [plan(need="disagrees", action="reconsider", lead="logic"), AIMessage(content="You have a point.")]
    response = run(said("Music helps everyone study.", "That generalizes from a few people.", "But my sample was large."))
    assert analyzer.calls == []
    assert response.action == "reconsider"
    assert "look again with an open mind. Say plainly when you were wrong." in system_prompt(captured[1])


# Specialists: distinct tools and selective delegation.


def test_the_mathematics_specialist_can_run_an_exact_check(hetu):
    run, captured, replies, _ = hetu
    replies += [
        plan(lead="mathematics", action="correct_misconception"),
        tool_call("find_counterexample", {"variables": "n", "hypothesis": "n**2 % 4 == 0", "conclusion": "n % 4 == 0"}),
        AIMessage(content="Try $n = 2$."),
    ]

    response = run(said("If 4 divides n² then 4 divides n, right?"))

    assert response.reply == "Try $n = 2$."
    assert [check.tool for check in response.checks] == ["find_counterexample"]
    assert response.checks[0].result.startswith("COUNTEREXAMPLE: n = 2.")
    # The tool result went back to the model before it wrote the reply.
    assert captured[2]["messages"][-1].type == "tool"


def test_the_logic_specialist_gets_a_second_reader_before_claiming_a_flaw(hetu):
    run, captured, replies, _ = hetu
    replies += [
        plan(lead="logic", action="challenge_assumption", need="has_misconception"),
        tool_call("task", {"description": "Argument: ... Suspected flaw: hasty generalization.", "subagent_type": "second_reader"}),
        AIMessage(content="FLAWED: a few friends do not show what happens for everyone."),
        AIMessage(content="Your friends' grades are a start, but they cannot speak for everyone."),
    ]

    response = run(said("Everyone I know who studies with music gets better grades, so music makes everyone perform better."))

    assert tool_names(captured[1]) == {"task"}
    assert system_prompt(captured[2]).startswith("You are a second reader")
    assert response.reply.startswith("Your friends' grades are a start")
    # The second reader is an internal check, not a subject specialist.
    assert response.specialists == ["logic"]


def test_a_lead_consults_another_specialist_only_when_the_plan_names_one(hetu):
    run, captured, replies, _ = hetu
    replies += [
        plan(lead="programming", consult=["mathematics"]),
        tool_call("task", {"description": "Why is binary search O(log n)?", "subagent_type": "mathematics"}),
        AIMessage(content="Each step halves the range."),
        AIMessage(content="Binary search halves the list each time."),
    ]

    response = run(said("Why is binary search logarithmic?"))

    assert response.specialists == ["programming", "mathematics"]
    assert system_prompt(captured[2]).startswith(SPECIALIST_PROMPTS["mathematics"])


def test_no_specialist_is_listed_when_the_coach_answers_alone(hetu):
    run, _, replies, _ = hetu
    replies += [plan(lead="coach"), AIMessage(content="What would you like to learn today?")]
    assert run(said("hello")).specialists == []


# Failures: the student still gets a real answer, or a clear error.


def test_a_plan_that_will_not_parse_is_retried_then_skipped(hetu):
    run, captured, replies, _ = hetu
    replies += [AIMessage(content="not json"), AIMessage(content="still not json"), AIMessage(content="A direct answer.")]
    notes = LearningState(topic="integration")

    response = run(said("Help me with integration.", notes=notes))

    assert response.reply == "A direct answer."
    assert response.specialists == []
    assert response.learning_state.topic == "integration"
    assert len(captured) == 3


def test_a_failed_specialist_run_falls_back_to_one_plain_call(hetu):
    run, captured, replies, _ = hetu
    replies += [
        plan(lead="mathematics"),
        RuntimeError("Failed to parse tool call arguments as JSON"),
        AIMessage(content="A derivative measures how fast something changes."),
    ]

    response = run(said("What is a derivative?"))

    assert response.reply.startswith("A derivative measures")
    assert "tools" in captured[1]
    assert "tools" not in captured[2]
    assert system_prompt(captured[2]).startswith(SPECIALIST_PROMPTS["mathematics"])


def test_an_empty_reply_is_an_error_not_a_blank_message(hetu):
    run, _, replies, _ = hetu
    replies += [plan(), AIMessage(content=""), AIMessage(content="   ")]
    with pytest.raises(RuntimeError):
        run(said("hello"))


# Help the student chose, and notes the student corrected.


@pytest.mark.parametrize(
    ("assist", "action", "guidance"),
    [
        ("hint", "give_hint", "Give one hint that moves them one step forward."),
        ("try", "let_student_try", "Do not explain or solve."),
        ("example", "demonstrate", "Give one concrete worked example"),
    ],
)
def test_the_help_the_student_chose_decides_the_action(hetu, assist, action, guidance):
    run, captured, replies, _ = hetu
    replies += [plan(lead="mathematics", action="explain"), AIMessage(content="Try factoring first.")]

    response = run(said("How do I solve x² - 5x + 6 = 0?", assist=assist))

    assert response.action == action
    assert guidance in captured[0]["messages"][-1].content
    assert guidance in captured[1]["messages"][-1].content


def test_a_disagreement_is_not_overridden_by_the_chosen_help(hetu):
    run, _, replies, _ = hetu
    replies += [plan(need="disagrees", action="reconsider", lead="logic"), AIMessage(content="You may be right.")]
    response = run(said("Studying with music helps.", "That generalizes from a few friends.", "No, I cited a study.", assist="hint"))
    assert response.action == "reconsider"


def test_the_session_intent_reaches_both_stages(hetu):
    run, captured, replies, _ = hetu
    replies += [plan(lead="mathematics"), AIMessage(content="What have you tried?")]
    run(said("I need to integrate x e^x.", intent="solve"))
    for call in captured:
        assert "leave the steps to them" in call["messages"][-1].content


def test_notes_the_student_removed_are_never_added_back(hetu):
    run, captured, replies, _ = hetu
    replies.append(
        plan(
            learning_state={
                "topic": "inheritance",
                "misconceptions": ["Thinks a subclass copies its parent's code", "Confuses objects and classes"],
                "open_questions": ["When to use composition"],
            }
        )
    )
    replies.append(AIMessage(content="Fine."))
    notes = LearningState(topic="inheritance", dismissed=["confuses objects and classes"])

    response = run(said("ok", notes=notes))

    assert response.learning_state.misconceptions == ["Thinks a subclass copies its parent's code"]
    assert response.learning_state.open_questions == ["When to use composition"]
    assert response.learning_state.dismissed == ["confuses objects and classes"]
    assert "Removed by the student: confuses objects and classes" in captured[0]["messages"][-1].content
