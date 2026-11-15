"""Verification of Neon Auth tokens.

The browser sends a signed-in user's token with each chat request. This
module checks the token's signature against Neon Auth's published keys and
reads the user id from the verified `sub` claim. The API never uses a user
id that the browser states.

The identity only decides whose rate limit a request counts against. The API
reads and writes no user data, so a request without a valid token is simply
treated as a guest.
"""

import logging
from urllib.parse import urlsplit

import jwt

logger = logging.getLogger("hetu")

# Neon Auth signs with Ed25519. Accepting only this algorithm blocks tokens
# that name a weaker one, including "none".
ALGORITHMS = ["EdDSA"]
LEEWAY_SECONDS = 30


class TokenVerifier:
    """Verifies Neon Auth tokens with the public keys at `<auth url>/.well-known/jwks.json`."""

    def __init__(self, auth_url: str, jwks_client: jwt.PyJWKClient | None = None) -> None:
        base = auth_url.rstrip("/")
        parts = urlsplit(base)
        origin = f"{parts.scheme}://{parts.netloc}"
        # Neon documents the Auth URL as the issuer. Better Auth can also use
        # the origin alone. Both are addresses Neon controls, so either is accepted.
        self._accepted = [base, origin]
        self._keys = jwks_client or jwt.PyJWKClient(f"{base}/.well-known/jwks.json", cache_keys=True, lifespan=3600, timeout=5)

    def user_id(self, token: str) -> str | None:
        """The verified user id, or None if the token is missing, invalid, expired, or unverifiable."""
        if not token:
            return None
        try:
            key = self._keys.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key,
                algorithms=ALGORITHMS,
                issuer=self._accepted,
                audience=self._accepted,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "sub"]},
            )
        except jwt.PyJWKClientConnectionError as error:
            logger.warning("could not fetch Neon Auth keys: %s", str(error)[:200])
            return None
        except jwt.PyJWTError as error:
            logger.warning("rejected a token, treating the request as a guest: %s: %s", type(error).__name__, str(error)[:200])
            return None
        subject = claims.get("sub")
        return subject if isinstance(subject, str) and subject else None


def bearer_token(authorization: str) -> str:
    """The token from an `Authorization: Bearer <token>` header, or an empty string."""
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""
