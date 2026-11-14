"""Hetu API.

Only the health check exists so far. `POST /analyze` is planned and will
return the `Analysis` shape defined in `app/schemas.py`.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.schemas import HealthResponse

settings = get_settings()

app = FastAPI(title="Hetu API", version="0.1.0")

# The browser blocks cross-origin calls unless the API names the frontend's
# origin. Origins are listed explicitly; no wildcard and no credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")
