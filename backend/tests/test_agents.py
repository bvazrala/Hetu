"""Workflow tests. Every model reply here is scripted; nothing calls a provider."""

import asyncio
import json
import pytest
from langchain_core.messages import AIMessage

from app import agents
from app.agents import AnalysisError, DraftAnalysis, Gap, Step, to_analysis
from app.config import Settings
from app.schemas import Challenge
from tests.fakes import ScriptedChatModel, tool_call

PROBLEM = "Prove that if the integer n² is even, then n is even."
DRAFT = "Assume n² = 2k for some integer k. Then n = √(2k), so n must be even."

STEPS = [
    {"type": "assumption", "text": "Assume n² = 2k for some integer k.", "relies_on": []},
    {"type": "inference", "text": "Then n = √(2k)", "relies_on": [1]},
    {"type": "conclusion", "text": "so n must be even.", "relies_on": [2]},
]
GAP = {
    "step": 3,
    "issue_type": "unjustified_step",
    "question": "Why does taking the square root of 2k show that n is divisible by two?",
    "hint": "Consider the contrapositive.",
}


# to_analysis: the deterministic clean-up


def test_to_analysis_builds_ids_spans_edges_and_one_observation():
    analysis = to_analysis(DRAFT, DraftAnalysis(steps=STEPS, gap=GAP))

    assert analysis.source == "live"
    assert [n.id for n in analysis.nodes] == ["n1", "n2", "n3"]
    for node in analysis.nodes:
        assert node.span is not None
        assert DRAFT[node.span.start : node.span.end] == node.text
    assert [(e.source, e.target) for e in analysis.edges] == [("n2", "n1"), ("n3", "n2")]

    (observation,) = analysis.observations
    assert observation.target == "n3"
    assert observation.evidence == "so n must be even."
    assert observation.verification == "not_verified"
    assert len(analysis.limitations) == 1


def test_to_analysis_without_gap_has_no_observation():
    analysis = to_analysis(DRAFT, DraftAnalysis(steps=STEPS, gap=None))
    assert analysis.observations == []


def test_to_analysis_drops_references_to_later_or_missing_steps():
    steps = [
        Step(type="assumption", text="Assume n² = 2k for some integer k.", relies_on=[2, 9]),
        Step(type="inference", text="Then n = √(2k)", relies_on=[1, 1, 0, 2]),
    ]
    analysis = to_analysis(DRAFT, DraftAnalysis(steps=steps))
    assert [(e.source, e.target) for e in analysis.edges] == [("n2", "n1")]


def test_to_analysis_marks_paraphrased_steps_as_unmatched():
    steps = [Step(type="claim", text="n squared equals two k")]
    analysis = to_analysis(DRAFT, DraftAnalysis(steps=steps))
    assert analysis.nodes[0].span is None
    assert len(analysis.limitations) == 2


def test_to_analysis_maps_repeated_phrases_in_order():
    draft = "n is even. So n² is even. Hence n is even."
    steps = [Step(type="claim", text="n is even."), Step(type="conclusion", text="n is even.")]
    analysis = to_analysis(draft, DraftAnalysis(steps=steps))
    assert analysis.nodes[0].span.start == 0
    assert analysis.nodes[1].span.start == draft.rindex("n is even.")


def test_to_analysis_rejects_a_gap_in_a_missing_step():
    with pytest.raises(AnalysisError):
        to_analysis(DRAFT, DraftAnalysis(steps=STEPS, gap=Gap(**{**GAP, "step": 7})))


def test_to_analysis_rejects_an_empty_answer():
    with pytest.raises(AnalysisError):
        to_analysis(DRAFT, DraftAnalysis(steps=[]))


# Deep Agents workflow with a scripted model


def test_deep_agent_consults_the_critic_then_reports_the_gap():
    model = ScriptedChatModel(
        script=[
            tool_call("task", {"description": "Check step 3 of this draft.", "subagent_type": "critic"}),
            AIMessage(content="UNJUSTIFIED: the square root says nothing about divisibility."),
            tool_call("submit_analysis", {"steps": STEPS, "gap": GAP}, call_id="call_2"),
        ]
    )
    analyze = agents._deep_agent_analyzer(model)

    analysis = asyncio.run(analyze(PROBLEM, DRAFT))

    assert analysis.observations[0].target == "n3"
    assert len(model.seen) == 3
    system_prompts = [messages[0].content for messages in model.seen]
    assert system_prompts == [agents.ORCHESTRATOR_PROMPT, agents.CRITIC_PROMPT, agents.ORCHESTRATOR_PROMPT]
    # The draft reaches the orchestrator unchanged.
    assert DRAFT in model.seen[0][1].content


def test_a_failed_attempt_runs_the_fallback():
    attempts = 0

    async def flaky(problem: str, draft: str, challenge=None):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("tool call validation failed")
        return to_analysis(draft, DraftAnalysis(steps=STEPS))

    analysis = asyncio.run(agents._with_fallback(flaky, flaky, "retrying")(PROBLEM, DRAFT))
    assert attempts == 2
    assert analysis.source == "live"


def test_a_failing_fallback_is_not_retried_again():
    attempts = 0

    async def broken(problem: str, draft: str, challenge=None):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("still failing")

    with pytest.raises(RuntimeError):
        asyncio.run(agents._with_fallback(broken, broken, "retrying")(PROBLEM, DRAFT))
    assert attempts == 2


def test_deep_agent_can_finish_without_a_gap():
    model = ScriptedChatModel(script=[tool_call("submit_analysis", {"steps": STEPS, "gap": None})])
    analysis = asyncio.run(agents._deep_agent_analyzer(model)(PROBLEM, DRAFT))
    assert analysis.observations == []
    assert len(model.seen) == 1


# The real Groq integration class, with the network call replaced


def test_deep_agent_offers_groq_only_the_two_tools_it_needs(groq_requests):
    captured, replies = groq_requests
    replies.append(tool_call("submit_analysis", {"steps": STEPS, "gap": None}))

    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-20b", workflow="deep_agent")
    asyncio.run(agents.build_analyzer(settings)(PROBLEM, DRAFT))

    tool_names = {tool["function"]["name"] for tool in captured[0]["tools"]}
    assert tool_names == {"task", "submit_analysis"}
    # Every tool name is lowercase, so a model that lowercases names still matches.
    assert all(name == name.lower() for name in tool_names)


def test_direct_workflow_parses_json_from_groq(groq_requests):
    captured, replies = groq_requests
    replies.append(AIMessage(content=json.dumps({"steps": STEPS, "gap": GAP})))

    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-20b", workflow="direct")
    analysis = asyncio.run(agents.build_analyzer(settings)(PROBLEM, DRAFT))

    assert analysis.observations[0].issue_type == "unjustified_step"
    assert "tools" not in captured[0]
    assert captured[0]["response_format"]["type"] == "json_schema"


def test_deep_agent_falls_back_to_the_direct_workflow(groq_requests):
    captured, replies = groq_requests
    # The deep agent's only model call fails the way Groq does when the model
    # returns no tool call. The direct workflow then answers.
    replies.append(RuntimeError("Tool choice is required, but model did not call a tool"))
    replies.append(AIMessage(content=json.dumps({"steps": STEPS, "gap": GAP})))

    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-120b", workflow="deep_agent")
    analysis = asyncio.run(agents.build_analyzer(settings)(PROBLEM, DRAFT))

    assert analysis.observations[0].target == "n3"
    assert len(captured) == 2
    assert "tools" in captured[0]  # first attempt: deep agent with tools
    assert "tools" not in captured[1]  # second attempt: direct, no tools
    assert captured[1]["response_format"]["type"] == "json_schema"


def test_the_direct_workflow_retries_itself_once(groq_requests):
    captured, replies = groq_requests
    replies.append(AIMessage(content="this is not json"))
    replies.append(AIMessage(content=json.dumps({"steps": STEPS, "gap": None})))

    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-120b", workflow="direct")
    analysis = asyncio.run(agents.build_analyzer(settings)(PROBLEM, DRAFT))

    assert analysis.observations == []
    assert len(captured) == 2


# Source spans: exact text only


def test_a_step_matches_across_line_breaks_in_the_draft():
    draft = "Assume n² = 2k\nfor some integer k.   Then n is even."
    steps = [Step(type="assumption", text="Assume n² = 2k for some integer k.")]

    span = to_analysis(draft, DraftAnalysis(steps=steps)).nodes[0].span

    assert span is not None
    assert draft[span.start : span.end] == "Assume n² = 2k\nfor some integer k."


def test_an_out_of_order_step_is_matched_only_when_its_text_is_unique():
    draft = "n is even. So n² is even. Hence n is even."
    steps = [
        Step(type="conclusion", text="Hence n is even."),
        Step(type="inference", text="So n² is even."),  # earlier in the draft, occurs once
        Step(type="claim", text="n is even."),  # earlier in the draft, occurs twice
    ]

    nodes = to_analysis(draft, DraftAnalysis(steps=steps)).nodes

    assert draft[nodes[1].span.start : nodes[1].span.end] == "So n² is even."
    assert nodes[2].span is None


def test_a_reworded_step_gets_no_span_even_when_similar_text_exists():
    steps = [Step(type="inference", text="Then n equals √(2k)")]  # the draft says "n = √(2k)"
    analysis = to_analysis(DRAFT, DraftAnalysis(steps=steps))
    assert analysis.nodes[0].span is None
    assert any("could not be matched" in item for item in analysis.limitations)


def test_an_empty_step_gets_no_span():
    steps = [Step(type="claim", text="   ")]
    assert to_analysis(DRAFT, DraftAnalysis(steps=steps)).nodes[0].span is None


# Challenges

CHALLENGE = Challenge(
    step_text="so n must be even.",
    question=GAP["question"],
    reason="A square root of an even number is even.",
)


def test_a_challenge_is_maintained_when_the_same_step_is_still_questioned():
    output = DraftAnalysis(steps=STEPS, gap=GAP, challenge_response="  The draft still does not say why.  ")
    result = to_analysis(DRAFT, output, CHALLENGE).challenge
    assert result.outcome == "maintained"
    assert result.response == "The draft still does not say why."


def test_a_challenge_is_withdrawn_when_no_gap_remains():
    output = DraftAnalysis(steps=STEPS, gap=None, challenge_response="You are right, that step is routine.")
    analysis = to_analysis(DRAFT, output, CHALLENGE)
    assert analysis.challenge.outcome == "withdrawn"
    assert analysis.observations == []


def test_a_challenge_is_withdrawn_when_the_question_moves_to_another_step():
    output = DraftAnalysis(steps=STEPS, gap={**GAP, "step": 2})
    analysis = to_analysis(DRAFT, output, CHALLENGE)
    assert analysis.challenge.outcome == "withdrawn"
    assert analysis.observations[0].target == "n2"


def test_a_challenge_outcome_follows_the_analysis_not_the_models_summary():
    # The model claims to withdraw but still reports the gap. The gap wins.
    output = DraftAnalysis(steps=STEPS, gap=GAP, challenge_response="I withdraw the question.")
    assert to_analysis(DRAFT, output, CHALLENGE).challenge.outcome == "maintained"


def test_a_challenge_gets_a_default_response_when_the_model_gives_none():
    result = to_analysis(DRAFT, DraftAnalysis(steps=STEPS, gap=None), CHALLENGE).challenge
    assert result.response


def test_an_analysis_without_a_challenge_has_no_challenge_result():
    assert to_analysis(DRAFT, DraftAnalysis(steps=STEPS, gap=GAP)).challenge is None


def test_the_challenge_reaches_the_model_with_rules_for_both_outcomes():
    message = agents._user_message(PROBLEM, DRAFT, CHALLENGE)
    assert CHALLENGE.reason in message
    assert CHALLENGE.step_text in message
    assert "withdraw the question" in message
    assert "Keep the gap" in message
    assert "Neither of you is assumed to be right" in message
    # A plain analysis carries none of this.
    assert "challenge" not in agents._user_message(PROBLEM, DRAFT)


def test_deep_agent_reconsiders_a_challenged_step():
    model = ScriptedChatModel(
        script=[
            tool_call(
                "submit_analysis",
                {"steps": STEPS, "gap": None, "challenge_response": "That step is routine. I withdraw the question."},
            )
        ]
    )

    analysis = asyncio.run(agents._deep_agent_analyzer(model)(PROBLEM, DRAFT, CHALLENGE))

    assert analysis.challenge.outcome == "withdrawn"
    assert CHALLENGE.reason in model.seen[0][1].content
    # The draft itself is sent unchanged.
    assert f"<draft>\n{DRAFT}\n</draft>" in model.seen[0][1].content


def test_direct_workflow_reconsiders_a_challenged_step(groq_requests):
    captured, replies = groq_requests
    replies.append(AIMessage(content=json.dumps({"steps": STEPS, "gap": GAP, "challenge_response": "Still open."})))

    settings = Settings(llm_provider="groq", llm_model="openai/gpt-oss-120b", workflow="direct")
    analysis = asyncio.run(agents.build_analyzer(settings)(PROBLEM, DRAFT, CHALLENGE))

    assert analysis.challenge.outcome == "maintained"
    assert analysis.challenge.response == "Still open."
    assert CHALLENGE.reason in captured[0]["messages"][1].content
