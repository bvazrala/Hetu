"""Hetu API: `GET /health`, `POST /chat`, and `POST /analyze`."""

import asyncio
import logging
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.agents import Analyzer, build_analyzer
from app.auth import TokenVerifier, bearer_token
from app.config import get_settings
from app.limits import RequestLimiter, client_address
from app.llm import InferenceNotConfigured
from app.schemas import Analysis, AnalyzeRequest, ChatRequest, ChatResponse, HealthResponse
from app.tutor import Tutor, build_tutor

logger = logging.getLogger("hetu")
settings = get_settings()

app = FastAPI(title="Hetu API", version="0.1.0")

# The browser blocks cross-origin calls unless the API names the frontend's
# origin. Origins are listed explicitly; no wildcard and no credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


limiter = RequestLimiter(settings.rate_limit_per_minute, settings.daily_analysis_limit)


@lru_cache
def get_verifier() -> TokenVerifier | None:
    """The Neon Auth token verifier, or None when accounts are not configured."""
    url = get_settings().neon_auth_url
    return TokenVerifier(url) if url else None


def enforce_limits(request: Request) -> None:
    """Dependency that answers 429 when a client or the whole service is over its limit.

    A signed-in user is counted by the account in their verified token. Anyone
    else, including a request with a token that does not verify, is counted
    by address as a guest.
    """
    verifier = get_verifier()
    token = bearer_token(request.headers.get("authorization", ""))
    user = verifier.user_id(token) if verifier and token else None
    if user:
        client, per_day = f"user:{user}", settings.daily_limit_per_user
    else:
        address = client_address(
            peer=request.client.host if request.client else "unknown",
            forwarded_for=request.headers.get("x-forwarded-for", ""),
            trusted_proxy_hops=settings.trusted_proxy_hops,
        )
        client, per_day = f"guest:{address}", settings.daily_limit_per_guest
    message = limiter.check(client, per_day)
    if message:
        raise HTTPException(429, message, headers={"Retry-After": "60"})


@lru_cache
def _cached_analyzer() -> Analyzer:
    # lru_cache does not store exceptions, so a failed build is tried again.
    return build_analyzer(get_settings())


def get_analyzer() -> Analyzer:
    """Dependency that provides the workflow, or answers 503 if it cannot be built."""
    try:
        return _cached_analyzer()
    except InferenceNotConfigured:
        raise HTTPException(503, "Live analysis is not configured on this server.") from None
    except Exception:
        # For example: a missing API key or a provider package that is not installed.
        logger.exception("Could not build the analysis workflow")
        raise HTTPException(503, "Live analysis is not available on this server.") from None


@lru_cache
def _cached_tutor() -> Tutor:
    return build_tutor(get_settings())


def get_tutor() -> Tutor:
    """Dependency that provides the learning system, or answers 503 if it cannot be built."""
    try:
        return _cached_tutor()
    except InferenceNotConfigured:
        raise HTTPException(503, "Hetu is not configured on this server.") from None
    except Exception:
        logger.exception("Could not build the learning system")
        raise HTTPException(503, "Hetu is not available on this server.") from None


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/analyze", dependencies=[Depends(enforce_limits)])
async def analyze(request: AnalyzeRequest, analyzer: Annotated[Analyzer, Depends(get_analyzer)]) -> Analysis:
    """Analyze one draft, or reconsider it in light of a challenge.

    Errors never include provider details; those go to the log.
    """
    try:
        return await asyncio.wait_for(
            analyzer(request.problem, request.draft, request.challenge),
            timeout=settings.analyze_timeout_seconds,
        )
    except TimeoutError:
        raise HTTPException(504, "The analysis took too long. Please try again.") from None
    except Exception:
        logger.exception("Analysis failed")
        raise HTTPException(502, "The analysis could not be completed. Please try again.") from None


@app.post("/chat", dependencies=[Depends(enforce_limits)])
async def chat(request: ChatRequest, tutor: Annotated[Tutor, Depends(get_tutor)]) -> ChatResponse:
    """Answer one turn of a learning conversation.

    The server keeps no session. The request carries the recent turns and the
    session notes, and the response returns the updated notes.
    """
    try:
        return await asyncio.wait_for(tutor(request), timeout=settings.analyze_timeout_seconds)
    except TimeoutError:
        raise HTTPException(504, "Hetu took too long to answer. Please try again.") from None
    except Exception:
        logger.exception("Chat turn failed")
        raise HTTPException(502, "Hetu could not answer. Please try again.") from None
