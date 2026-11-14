from fastapi.testclient import TestClient
from app.main import app


def test_authentication_covers_every_service_route(monkeypatch):
    monkeypatch.setenv('AI_SERVICE_TOKEN', 'test-token')
    with TestClient(app) as client:
        for path in ['/health', '/transcription/health', '/judge', '/transcribe', '/live-feedback', '/elo/preview', '/docs', '/openapi.json']:
            method = client.get if path in ['/health', '/transcription/health', '/docs', '/openapi.json'] else client.post
            for headers in [{}, {'Authorization': 'Bearer wrong'}, {'Authorization': 'test-token'}]:
                assert method(path, headers=headers).status_code == 401
        assert client.get('/health', headers={'Authorization': 'Bearer test-token'}).status_code == 200
        # Authentication succeeds before payload validation, without invoking inference.
        assert client.post('/judge', headers={'Authorization': 'Bearer test-token'}, json={}).status_code == 422


def test_required_auth_fails_closed(monkeypatch):
    monkeypatch.delenv('AI_SERVICE_TOKEN', raising=False)
    monkeypatch.setenv('AI_REQUIRE_AUTH', 'true')
    with TestClient(app) as client:
        assert client.get('/health').status_code == 503


def test_local_development_remains_available(monkeypatch):
    monkeypatch.delenv('AI_SERVICE_TOKEN', raising=False)
    monkeypatch.delenv('AI_REQUIRE_AUTH', raising=False)
    with TestClient(app) as client:
        assert client.get('/health').status_code == 200
