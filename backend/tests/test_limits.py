from fastapi.testclient import TestClient

from app import main
from app.limits import RequestLimiter, client_address


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
    async def analyzer(problem: str, draft: str, challenge=None):
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


def test_forwarded_header_is_ignored_without_a_trusted_proxy():
    assert client_address("10.0.0.1", "6.6.6.6", trusted_proxy_hops=0) == "10.0.0.1"


def test_only_the_entry_written_by_the_trusted_proxy_is_used():
    # The client sent "6.6.6.6, 7.7.7.7" hoping to pass as someone else.
    # The proxy appended the real address at the end.
    header = "6.6.6.6, 7.7.7.7, 203.0.113.9"
    assert client_address("10.0.0.1", header, trusted_proxy_hops=1) == "203.0.113.9"
    assert client_address("10.0.0.1", header, trusted_proxy_hops=2) == "7.7.7.7"


def test_a_short_or_missing_forwarded_header_falls_back_to_the_peer():
    assert client_address("10.0.0.1", "", trusted_proxy_hops=1) == "10.0.0.1"
    assert client_address("10.0.0.1", "203.0.113.9", trusted_proxy_hops=2) == "10.0.0.1"


def test_a_forged_forwarded_header_does_not_reset_the_per_client_limit(monkeypatch):
    async def analyzer(problem: str, draft: str, challenge=None):
        raise RuntimeError("stop here")

    monkeypatch.setattr(main, "limiter", RequestLimiter(per_minute=1, per_day=100))
    monkeypatch.setattr(main.settings, "trusted_proxy_hops", 0)
    main.app.dependency_overrides[main.get_analyzer] = lambda: analyzer
    client = TestClient(main.app)
    try:
        first = client.post("/analyze", json={"draft": "x"}, headers={"X-Forwarded-For": "1.1.1.1"})
        second = client.post("/analyze", json={"draft": "x"}, headers={"X-Forwarded-For": "2.2.2.2"})
    finally:
        main.app.dependency_overrides.clear()

    assert first.status_code == 502
    assert second.status_code == 429
