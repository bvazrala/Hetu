from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_dev_frontend_origin_is_allowed():
    origin = "http://localhost:5173"
    response = client.get("/health", headers={"Origin": origin})
    assert response.headers.get("access-control-allow-origin") == origin


def test_unknown_origin_is_not_allowed():
    response = client.get("/health", headers={"Origin": "http://example.com"})
    assert "access-control-allow-origin" not in response.headers
