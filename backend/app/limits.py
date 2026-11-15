"""Request limits for the endpoint that costs money.

Counts live in memory, so they reset when the process restarts and are not
shared between processes. These limits slow abuse down. They do not cap the
provider bill, so a spend limit at the provider is still needed.
"""

import time
from collections import defaultdict, deque
from collections.abc import Callable

_WINDOW_SECONDS = 60
_SECONDS_PER_DAY = 86_400


class RequestLimiter:
    def __init__(self, per_minute: int, per_day: int, clock: Callable[[], float] = time.time) -> None:
        self.per_minute = per_minute  # for one client
        self.per_day = per_day  # for everyone together
        self._clock = clock
        self._recent: defaultdict[str, deque[float]] = defaultdict(deque)
        self._day = -1
        self._count_today = 0

    def check(self, client: str) -> str | None:
        """Record one request. Return None if it may proceed, or a message if it may not."""
        now = self._clock()

        day = int(now // _SECONDS_PER_DAY)
        if day != self._day:
            self._day, self._count_today = day, 0
            self._recent.clear()

        recent = self._recent[client]
        while recent and recent[0] <= now - _WINDOW_SECONDS:
            recent.popleft()

        if len(recent) >= self.per_minute:
            return "Too many requests. Wait a minute and try again."
        if self._count_today >= self.per_day:
            return "Hetu has reached its daily analysis limit. Try again tomorrow."

        recent.append(now)
        self._count_today += 1
        return None


def client_address(peer: str, forwarded_for: str, trusted_proxy_hops: int) -> str:
    """Choose the address that the per-client limit should count against.

    A client can put anything in X-Forwarded-For, so its left side is never
    trusted. Each proxy appends the address it received the request from, so
    only the last `trusted_proxy_hops` entries were written by infrastructure
    we rely on. With no trusted proxy, the socket peer is used and the header
    is ignored.
    """
    if trusted_proxy_hops <= 0:
        return peer
    entries = [entry.strip() for entry in forwarded_for.split(",") if entry.strip()]
    if len(entries) < trusted_proxy_hops:
        return peer
    return entries[-trusted_proxy_hops]
