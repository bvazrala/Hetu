"""Runtime configuration, read from environment variables.

Values come from the process environment first, then from `backend/.env`
if that file exists. See `backend/.env.example` for every variable.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_prefix="HETU_",
        extra="ignore",
    )

    # Comma-separated list of browser origins allowed to call the API.
    cors_origins: str = "http://localhost:5173"

    # Inference is not implemented yet, so nothing reads these two values.
    # They are the single place the future model adapter should learn which
    # provider and model to use. Switching models should then be a change to
    # the environment, not to the reasoning code.
    llm_provider: str | None = None
    llm_model: str | None = None

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
