"""Runtime configuration, read from environment variables.

Values come from the process environment first, then from `backend/.env`
if that file exists. See `backend/.env.example` for every variable.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Provider SDKs look for their own key variables, such as GROQ_API_KEY, in the
# process environment. Loading `.env` here makes those keys visible to them
# without this code naming any provider. Real environment variables win.
load_dotenv(BACKEND_DIR / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HETU_", extra="ignore")

    # Comma-separated list of browser origins allowed to call the API.
    cors_origins: str = "http://localhost:5173"

    # Which hosted model to use. These two values are read only by
    # `app/llm.py`. Switching models is a change to the environment.
    llm_provider: str | None = None
    llm_model: str | None = None

    # 0 asks the model for its most likely answer every time, so the same
    # draft gets the same feedback as often as the provider allows.
    llm_temperature: float = 0.0

    # "deep_agent": an orchestrator that can consult a critic subagent.
    # "direct": one structured model call. Simpler, faster, no second opinion.
    workflow: Literal["deep_agent", "direct"] = "deep_agent"

    # Upper bound on one analysis, in seconds.
    analyze_timeout_seconds: float = 60.0

    # Limits on POST /analyze. The first is per client address, the second
    # is shared by all clients and bounds what one day can cost.
    rate_limit_per_minute: int = 20
    daily_analysis_limit: int = 500

    @field_validator("llm_provider", "llm_model", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: str | None) -> str | None:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
