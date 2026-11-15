"""Check on the real Neon project that one user cannot reach another's data.

This signs in as two test accounts through Neon Auth, then uses the Data API
exactly as the browser does. User A creates a conversation, and user B tries
to read, change, delete, and add to it. Finally A deletes it again.

Create two email and password accounts in Hetu first and confirm both. Then,
from the backend directory:

    uv run python -m scripts.check_isolation \\
        --a-email a@example.com --b-email b@example.com

The passwords are asked for and are not echoed or stored. NEON_AUTH_URL and
NEON_DATA_API_URL are read from the environment or backend/.env, or can be
given with --auth-url and --data-api-url. Requests carry an Origin header,
http://localhost:5173 by default, which Neon Auth must trust.
"""

import argparse
import getpass
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.config import BACKEND_DIR  # noqa: F401  loads backend/.env


@dataclass
class Reply:
    status: int
    body: object
    headers: dict[str, str]


class Client:
    """One signed-in user: a cookie jar for Neon Auth and a token for the Data API."""

    def __init__(self, auth_url: str, data_url: str, origin: str):
        self.auth_url = auth_url.rstrip("/")
        self.data_url = data_url.rstrip("/")
        self.origin = origin
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token: str | None = None
        self.user_id: str | None = None

    def call(self, method: str, url: str, body=None, headers=None) -> Reply:
        request = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode())
        request.add_header("Origin", self.origin)
        request.add_header("Content-Type", "application/json")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read()
                status, response_headers = response.status, dict(response.headers)
        except urllib.error.HTTPError as error:
            raw, status, response_headers = error.read(), error.code, dict(error.headers)
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = raw.decode(errors="replace")
        return Reply(status, parsed, {name.lower(): value for name, value in response_headers.items()})

    def sign_in(self, email: str, password: str) -> None:
        reply = self.call("POST", f"{self.auth_url}/sign-in/email", {"email": email, "password": password})
        if reply.status != 200:
            raise SystemExit(f"Sign-in failed for {email}: {reply.status} {reply.body}")
        session = self.call("GET", f"{self.auth_url}/get-session")
        self.token = session.headers.get("set-auth-jwt")
        self.user_id = (session.body or {}).get("user", {}).get("id") if isinstance(session.body, dict) else None
        if not self.token or not self.user_id:
            raise SystemExit(f"Signed in as {email}, but no token came back from get-session.")

    def data(self, method: str, path: str, body=None, token: str | None = "self") -> Reply:
        headers = {"Prefer": "return=representation"}
        bearer = self.token if token == "self" else token
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        return self.call(method, f"{self.data_url}/{path}", body, headers)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--a-email", required=True)
    parser.add_argument("--b-email", required=True)
    parser.add_argument("--auth-url", default=os.environ.get("NEON_AUTH_URL") or os.environ.get("HETU_NEON_AUTH_URL"))
    parser.add_argument("--data-api-url", default=os.environ.get("NEON_DATA_API_URL"))
    parser.add_argument("--origin", default="http://localhost:5173")
    args = parser.parse_args()
    if not args.auth_url or not args.data_api_url:
        print("Give --auth-url and --data-api-url, or set NEON_AUTH_URL and NEON_DATA_API_URL.")
        return 2

    a = Client(args.auth_url, args.data_api_url, args.origin)
    b = Client(args.auth_url, args.data_api_url, args.origin)
    a.sign_in(args.a_email, getpass.getpass(f"Password for {args.a_email}: "))
    b.sign_in(args.b_email, getpass.getpass(f"Password for {args.b_email}: "))
    if a.user_id == b.user_id:
        print("Both emails signed in as the same user. Use two different accounts.")
        return 2

    results: list[tuple[str, bool, str]] = []

    def check(description: str, passed: bool, detail: object = "") -> None:
        results.append((description, passed, "" if passed else str(detail)[:300]))

    created = a.data("POST", "conversations", {"title": "Isolation check"})
    if created.status not in (200, 201) or not created.body:
        print(f"User A could not create a conversation: {created.status} {created.body}")
        return 1
    conversation = created.body[0]["id"]
    try:
        check("A's new conversation is owned by A", created.body[0].get("user_id") == a.user_id, created.body)
        added = a.data("POST", "messages", {"conversation_id": conversation, "role": "student", "content": "Private."})
        check("A can add a message", added.status in (200, 201), added.body)

        for table, column in [("conversations", "id"), ("messages", "conversation_id"), ("learning_states", "conversation_id")]:
            seen = b.data("GET", f"{table}?{column}=eq.{conversation}&select=*")
            check(f"B cannot read A's {table}", seen.status == 200 and seen.body == [], (seen.status, seen.body))

        everything = b.data("GET", "conversations?select=id")
        check("B's full list does not include A's conversation", conversation not in json.dumps(everything.body), everything.body)

        renamed = b.data("PATCH", f"conversations?id=eq.{conversation}", {"title": "Changed by B"})
        check("B cannot rename it", renamed.body in ([], None) or renamed.status >= 400, (renamed.status, renamed.body))
        deleted = b.data("DELETE", f"conversations?id=eq.{conversation}")
        check("B cannot delete it", deleted.body in ([], None) or deleted.status >= 400, (deleted.status, deleted.body))

        injected = b.data("POST", "messages", {"conversation_id": conversation, "role": "hetu", "content": "Injected."})
        check("B cannot add a message to it", injected.status >= 400, (injected.status, injected.body))
        notes = b.data("POST", "learning_states", {"conversation_id": conversation, "state": {}})
        check("B cannot add notes to it", notes.status >= 400, (notes.status, notes.body))
        forged = b.data("POST", "conversations", {"title": "Forged", "user_id": a.user_id})
        check("B cannot create a conversation in A's name", forged.status >= 400, (forged.status, forged.body))

        anonymous = b.data("GET", "conversations?select=id", token=None)
        check(
            "A request with no token sees nothing",
            anonymous.status >= 400 or anonymous.body == [],
            (anonymous.status, anonymous.body),
        )

        still = a.data("GET", f"conversations?id=eq.{conversation}&select=title")
        check("A's conversation is unchanged", still.body == [{"title": "Isolation check"}], still.body)
        messages = a.data("GET", f"messages?conversation_id=eq.{conversation}&select=content")
        check("A's messages are unchanged", messages.body == [{"content": "Private."}], messages.body)
    finally:
        a.data("DELETE", f"conversations?id=eq.{conversation}")

    for description, passed, detail in results:
        print(f"{'PASS' if passed else 'FAIL'}  {description}{'  ' + detail if detail else ''}")
    failed = sum(not passed for _, passed, _ in results)
    print(f"\n{len(results) - failed} of {len(results)} checks passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
