from __future__ import annotations

from unittest.mock import Mock, patch

from tome_agent.agent import http_client


def teardown_function() -> None:
    http_client.set_model_overrides(None)


def test_configured_model_precedes_environment(monkeypatch) -> None:
    monkeypatch.setenv("TTT_CHAT_MODEL", "model-environment")
    http_client.set_model_overrides(
        {
            "chat": {
                "model": "model-exact",
                "source": "exact",
                "scope_kind": "exact",
                "scope_id": "entity-1",
                "config_version": 4,
            }
        }
    )

    assert http_client.resolve_model_with_provenance(
        "chat", "model-fallback", ("TTT_CHAT_MODEL",)
    ) == {
        "model": "model-exact",
        "source": "exact",
        "scope_kind": "exact",
        "scope_id": "entity-1",
        "config_version": 4,
    }


def test_environment_precedes_builtin_fallback(monkeypatch) -> None:
    monkeypatch.setenv("TTT_INGEST_MODEL", "model-environment")
    assert http_client.resolve_model_with_provenance(
        "ingest", "model-fallback", ("TTT_INGEST_MODEL",)
    ) == {
        "model": "model-environment",
        "source": "environment",
        "scope_id": "TTT_INGEST_MODEL",
    }

    monkeypatch.delenv("TTT_INGEST_MODEL")
    assert http_client.resolve_model_with_provenance(
        "ingest", "model-fallback", ("TTT_INGEST_MODEL",)
    ) == {"model": "model-fallback", "source": "fallback"}


def test_fetch_model_config_scopes_request_and_preserves_provenance() -> None:
    response = Mock()
    response.json.return_value = {
        "models": [
            {
                "role": "synthesize",
                "model": "model-type",
                "source": "type",
                "scope_kind": "type",
                "scope_id": "area",
                "config_version": 2,
            }
        ]
    }
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.get.return_value = response

    with patch("tome_agent.agent.http_client.httpx.Client", return_value=client):
        result = http_client.fetch_model_config("entity-2", "area")

    client.get.assert_called_once_with(
        "http://backend:8765/api/internal/model-config",
        headers={},
        params={"entity_id": "entity-2", "entity_type": "area"},
    )
    assert result == {
        "synthesize": {
            "model": "model-type",
            "source": "type",
            "scope_kind": "type",
            "scope_id": "area",
            "config_version": 2,
        }
    }
