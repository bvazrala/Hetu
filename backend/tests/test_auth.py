"""Tests for Neon Auth token verification and per-account limits.

Tokens are signed with real Ed25519 keys made for each test, the same kind
Neon Auth uses. Only the key download is replaced.
"""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from app import main
from app.auth import TokenVerifier, bearer_token
from app.limits import RequestLimiter
from app.schemas import ChatResponse, LearningState

AUTH_URL = "https://ep-test.neonauth.us-east-2.aws.neon.tech/neondb/auth"
ORIGIN = "https://ep-test.neonauth.us-east-2.aws.neon.tech"


class StaticKeys:
    """Stands in for the JWKS download and serves one public key."""

    def __init__(self, private_key: Ed25519PrivateKey, kid: str = "key-1"):
        self.key = jwt.PyJWK.from_dict(
            {**jwt.algorithms.OKPAlgorithm.to_jwk(private_key.public_key(), as_dict=True), "kid": kid, "alg": "EdDSA"}
        )

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        return self.key


@pytest.fixture
def signing_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def token(key: Ed25519PrivateKey, **overrides) -> str:
    now = int(time.time())
    claims = {"sub": "user-123", "iss": AUTH_URL, "aud": AUTH_URL, "iat": now, "exp": now + 900, "role": "authenticated"}
    claims.update(overrides)
    claims = {name: value for name, value in claims.items() if value is not None}
    return jwt.encode(claims, key, algorithm="EdDSA", headers={"kid": "key-1"})


def verifier(key: Ed25519PrivateKey) -> TokenVerifier:
    return TokenVerifier(AUTH_URL, jwks_client=StaticKeys(key))


def test_a_valid_token_gives_the_user_id(signing_key):
    assert verifier(signing_key).user_id(token(signing_key)) == "user-123"


def test_the_origin_is_accepted_as_issuer_and_audience(signing_key):
    assert verifier(signing_key).user_id(token(signing_key, iss=ORIGIN, aud=ORIGIN)) == "user-123"


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": int(time.time()) - 120},
        {"iss": "https://attacker.example"},
        {"aud": "https://attacker.example"},
        {"aud": None},
        {"sub": None},
        {"exp": None},
    ],
    ids=["expired", "wrong issuer", "wrong audience", "no audience", "no subject", "no expiry"],
)
def test_a_token_with_bad_claims_is_rejected(signing_key, overrides):
    assert verifier(signing_key).user_id(token(signing_key, **overrides)) is None


def test_a_token_signed_by_another_key_is_rejected(signing_key):
    forged = token(Ed25519PrivateKey.generate())
    assert verifier(signing_key).user_id(forged) is None


def test_an_unsigned_or_symmetric_token_is_rejected(signing_key):
    claims = {"sub": "user-123", "iss": AUTH_URL, "aud": AUTH_URL, "exp": int(time.time()) + 900}
    unsigned = jwt.encode(claims, None, algorithm="none")
    symmetric = jwt.encode(claims, "a shared secret that is long enough", algorithm="HS256")
    for bad in (unsigned, symmetric, "not a token", ""):
        assert verifier(signing_key).user_id(bad) is None


def test_bearer_token_reads_only_the_bearer_scheme():
    assert bearer_token("Bearer abc.def.ghi") == "abc.def.ghi"
    assert bearer_token("bearer abc") == "abc"
    assert bearer_token("Basic abc") == ""
    assert bearer_token("") == ""


# How identity reaches the rate limit on POST /chat.

client = TestClient(main.app)
BODY = {"messages": [{"role": "student", "content": "Why is the sky blue?"}]}


async def tutor(request):
    return ChatResponse(reply="Light scatters.", action="explain", specialists=[], learning_state=LearningState())


@pytest.fixture
def api(monkeypatch, signing_key):
    monkeypatch.setattr(main, "limiter", RequestLimiter(per_minute=1000, per_day=1000))
    monkeypatch.setattr(main.settings, "daily_limit_per_guest", 2)
    monkeypatch.setattr(main.settings, "daily_limit_per_user", 3)
    monkeypatch.setattr(main, "get_verifier", lambda: verifier(signing_key))
    main.app.dependency_overrides[main.get_tutor] = lambda: tutor
    yield
    main.app.dependency_overrides.clear()


def post(authorization: str | None = None) -> int:
    headers = {"Authorization": authorization} if authorization else {}
    return client.post("/chat", json=BODY, headers=headers).status_code


def test_a_signed_in_user_gets_their_own_daily_allowance(api, signing_key):
    alice = f"Bearer {token(signing_key, sub='alice')}"
    bob = f"Bearer {token(signing_key, sub='bob')}"
    assert [post(alice) for _ in range(4)] == [200, 200, 200, 429]
    # Same address, different account: Bob is not affected by Alice's use.
    assert post(bob) == 200


def test_guests_share_an_allowance_by_address(api):
    assert [post() for _ in range(3)] == [200, 200, 429]


def test_a_forged_token_is_counted_as_a_guest(api, signing_key):
    forged = f"Bearer {token(Ed25519PrivateKey.generate(), sub='alice')}"
    assert [post(forged) for _ in range(3)] == [200, 200, 429]


def test_the_api_names_authorization_as_an_allowed_header():
    response = client.options(
        "/chat",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert "authorization" in response.headers.get("access-control-allow-headers", "").lower()
