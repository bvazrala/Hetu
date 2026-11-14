from fastapi.testclient import TestClient

from app import main
from app.limits import RequestLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


def test_a_client_is_stopped_after_its_requests_per_minute():
    clock = FakeClock()
    limiter = RequestLimiter(per_minute=2, per_day=100, clock=clock)

    assert limiter.check("a") is None
    assert limiter.check("a") is None
    assert "Too many requests" in limiter.check("a")
    # Another client is not affected.
    assert limiter.check("b") is None


def test_a_client_may_continue_after_the_window_passes():
    clock = FakeClock()
    limiter = RequestLimiter(per_minute=1, per_day=100, clock=clock)

    assert limiter.check("a") is None
    assert limiter.check("a") is not None
    clock.now += 61
    assert limiter.check("a") is None


def test_the_daily_limit_is_shared_and_resets_the_next_day():
    clock = FakeClock()
    limiter = RequestLimiter(per_minute=10, per_day=2, clock=clock)

    assert limiter.check("a") is None
    assert limiter.check("b") is None
    assert "daily" in limiter.check("c")
    clock.now += 86_400
    assert limiter.check("c") is None


def test_refused_requests_do_not_use_up_the_daily_limit():
    clock = FakeClock()
    limiter = RequestLimiter(per_minute=1, per_day=2, clock=clock)

    assert limiter.check("a") is None
    assert limiter.check("a") is not None  # refused, must not count
    assert limiter.check("b") is None


def test_analyze_answers_429_over_the_limit(monkeypatch):
    async def analyzer(problem: str, draft: str):
        raise RuntimeError("stop here")  # the limit is what this test is about

    monkeypatch.setattr(main, "limiter", RequestLimiter(per_minute=1, per_day=100))
    main.app.dependency_overrides[main.get_analyzer] = lambda: analyzer
    client = TestClient(main.app)
    try:
        first = client.post("/analyze", json={"draft": "x"})
        second = client.post("/analyze", json={"draft": "x"})
    finally:
        main.app.dependency_overrides.clear()

    assert first.status_code == 502
    assert second.status_code == 429
    assert second.headers["retry-after"] == "60"
