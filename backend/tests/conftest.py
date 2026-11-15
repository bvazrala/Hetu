"""Shared test fixtures. Nothing here reaches a model provider."""

from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_groq import ChatGroq


@pytest.fixture
def groq_requests(monkeypatch):
    """Capture what would be sent to Groq and answer from a script instead."""
    monkeypatch.setenv("GROQ_API_KEY", "test-key-not-real")
    captured: list[dict[str, Any]] = []
    replies: list[AIMessage | Exception] = []

    async def fake_agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        captured.append({"messages": messages, **kwargs})
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply  # stands in for an error answer from the provider
        return ChatResult(generations=[ChatGeneration(message=reply)])

    monkeypatch.setattr(ChatGroq, "_agenerate", fake_agenerate)
    return captured, replies
