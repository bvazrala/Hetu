"""Model adapter: the only module that knows which model is configured.

It turns `HETU_LLM_PROVIDER` and `HETU_LLM_MODEL` into a LangChain chat model.
The reasoning workflow receives that model and never names a provider itself.

The provider's API key is not handled here. Each LangChain integration reads
its own variable (for example GROQ_API_KEY) from the environment.
"""

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

from app.config import Settings


class InferenceNotConfigured(Exception):
    """Raised when no provider and model have been set."""


def model_spec(settings: Settings) -> str:
    """Return the "provider:model" name, such as "groq:openai/gpt-oss-120b"."""
    if not (settings.llm_provider and settings.llm_model):
        raise InferenceNotConfigured(
            "Set HETU_LLM_PROVIDER and HETU_LLM_MODEL in backend/.env to enable analysis."
        )
    return f"{settings.llm_provider}:{settings.llm_model}"


def build_chat_model(settings: Settings) -> BaseChatModel:
    """Build the configured chat model. Fails if the provider package or key is missing."""
    return init_chat_model(model_spec(settings), temperature=settings.llm_temperature)
