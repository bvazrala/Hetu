"""Endpoint tests for POST /analyze. The workflow is replaced by stubs."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import main
from app.limits import RequestLimiter
from app.llm import InferenceNotConfigured
from app.schemas import MAX_CHALLENGE_CHARS, MAX_DRAFT_CHARS, Analysis, ChallengeResult, Node

client = TestClient(main.app)

BODY = {"problem": "Prove that 2 is even.", "draft": "2 = 2 · 1, so 2 is even."}


def use_analyzer(analyzer):
    main.app.dependency_overrides[main.get_analyzer] = lambda: analyzer


@pytest.fixture(autouse=True)
def clean_overrides(monkeypatch):
    # These tests are not about request limits, so give them plenty of room.
    monkeypatch.setattr(main, "limiter", RequestLimiter(per_minute=1000, per_day=1000))
    yield
    main.app.dependency_overrides.clear()
    main._cached_analyzer.cache_clear()


def test_analyze_returns_the_workflow_result():
    async def analyzer(problem: str, draft: str, challenge=None) -> Analysis:
        node = Node(id="n1", type="claim", text=draft, span=None)
        return Analysis(source="live", nodes=[node], edges=[], observations=[], limitations=[])

    use_analyzer(analyzer)
    response = client.post("/analyze", json=BODY)

    assert response.status_code == 200
    assert response.json()["source"] == "live"
    assert response.json()["nodes"][0]["text"] == BODY["draft"]


def test_analyze_hides_provider_errors():
    async def analyzer(problem: str, draft: str, challenge=None) -> Analysis:
        raise RuntimeError("secret provider detail")

    use_analyzer(analyzer)
    response = client.post("/analyze", json=BODY)

    assert response.status_code == 502
    assert "secret" not in response.text


def test_analyze_times_out(monkeypatch):
    async def analyzer(problem: str, draft: str, challenge=None) -> Analysis:
        await asyncio.sleep(5)
        raise AssertionError("unreachable")

    monkeypatch.setattr(main.settings, "analyze_timeout_seconds", 0.05)
    use_analyzer(analyzer)

    assert client.post("/analyze", json=BODY).status_code == 504


def test_analyze_answers_503_when_no_model_is_configured(monkeypatch):
    def not_configured(settings):
        raise InferenceNotConfigured("no model")

    monkeypatch.setattr(main, "build_analyzer", not_configured)
    response = client.post("/analyze", json=BODY)

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


@pytest.mark.parametrize(
    "body",
    [
        {"problem": "", "draft": ""},
        {"problem": "", "draft": "   \n"},
        {"problem": "", "draft": "x" * (MAX_DRAFT_CHARS + 1)},
        {"problem": "p"},
    ],
)
def test_analyze_rejects_empty_and_oversized_drafts(body):
    use_analyzer(lambda: None)
    assert client.post("/analyze", json=body).status_code == 422


CHALLENGE = {"step_text": "so 2 is even.", "question": "Why is 2 even?", "reason": "2 = 2 · 1 fits the definition."}


def test_analyze_passes_a_challenge_to_the_workflow():
    received = {}

    async def analyzer(problem: str, draft: str, challenge=None) -> Analysis:
        received["challenge"] = challenge
        node = Node(id="n1", type="claim", text=draft, span=None)
        result = ChallengeResult(outcome="withdrawn", response="Agreed.")
        return Analysis(source="live", nodes=[node], edges=[], observations=[], limitations=[], challenge=result)

    use_analyzer(analyzer)
    response = client.post("/analyze", json={**BODY, "challenge": CHALLENGE})

    assert response.status_code == 200
    assert received["challenge"].reason == CHALLENGE["reason"]
    assert response.json()["challenge"] == {"outcome": "withdrawn", "response": "Agreed."}


def test_analyze_without_a_challenge_returns_none_for_it():
    async def analyzer(problem: str, draft: str, challenge=None) -> Analysis:
        assert challenge is None
        return Analysis(source="live", nodes=[], edges=[], observations=[], limitations=[])

    use_analyzer(analyzer)
    assert client.post("/analyze", json=BODY).json()["challenge"] is None


@pytest.mark.parametrize(
    "reason",
    ["", "   ", "x" * (MAX_CHALLENGE_CHARS + 1)],
)
def test_analyze_rejects_empty_and_oversized_challenges(reason):
    use_analyzer(lambda: None)
    body = {**BODY, "challenge": {**CHALLENGE, "reason": reason}}
    assert client.post("/analyze", json=body).status_code == 422
