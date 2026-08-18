from __future__ import annotations

import time

from fastapi.testclient import TestClient

from harness_engine.main import create_app
from harness_engine.repository import InMemoryRunRepository
from tests.conftest import FakeAgentCoreAdapter, auth_headers


def configure_agent(client: TestClient) -> None:
    response = client.put(
        "/api/v1/agents/agent-example/harness",
        headers=auth_headers(),
        json={"harness_id": "agentcore", "runtime_alias": "primary"},
    )
    assert response.status_code == 200


def test_run_continues_without_attached_event_client_and_replays_from_cursor(settings) -> None:
    adapter = FakeAgentCoreAdapter(chunks=["one", "two", "three"], delay=0.02)
    repository = InMemoryRunRepository()
    app = create_app(settings=settings, repository=repository, adapter=adapter)

    with TestClient(app) as client:
        configure_agent(client)
        started = client.post(
            "/api/v1/runs",
            headers=auth_headers(),
            json={
                "agent_id": "agent-example",
                "conversation_id": "conversation-example",
                "message": "keep running",
            },
        )
        assert started.status_code == 202
        run_id = started.json()["data"]["run_id"]

        # No event request is attached while the provider task finishes. This
        # models a browser/BFF disconnect immediately after start.
        time.sleep(0.15)

        first = client.get(
            f"/api/v1/runs/{run_id}/events?after=0",
            headers=auth_headers(),
        )
        assert first.status_code == 200
        first_page = first.json()["data"]
        assert first_page["run"]["status"] == "completed"
        assert [event["event_type"] for event in first_page["events"]] == [
            "run.started",
            "content.delta",
            "content.delta",
            "content.delta",
            "run.completed",
        ]
        cursor = first_page["events"][2]["sequence"]

        replay = client.get(
            f"/api/v1/runs/{run_id}/events?after={cursor}",
            headers=auth_headers(),
        ).json()["data"]
        assert [event["data"].get("text") for event in replay["events"]] == ["three", None]
        assert replay["next_cursor"] == first_page["next_cursor"]
        assert len(adapter.calls[0]["provider_session_id"]) >= 33

        second = client.post(
            "/api/v1/runs",
            headers={
                **auth_headers(),
                "traceparent": "00-11111111111111111111111111111111-2222222222222222-01",
            },
            json={
                "agent_id": "agent-example",
                "conversation_id": "conversation-example",
                "message": "continue the same thread",
            },
        )
        assert second.status_code == 202
        assert second.json()["data"]["provider_session_id"] == adapter.calls[0]["provider_session_id"]
        assert second.json()["data"]["traceparent"] == (
            "00-11111111111111111111111111111111-2222222222222222-01"
        )


def test_run_is_hidden_from_other_subjects(settings) -> None:
    app = create_app(
        settings=settings,
        repository=InMemoryRunRepository(),
        adapter=FakeAgentCoreAdapter(),
    )
    with TestClient(app) as client:
        configure_agent(client)
        run_id = client.post(
            "/api/v1/runs",
            headers=auth_headers(),
            json={
                "agent_id": "agent-example",
                "conversation_id": "conversation-example",
                "message": "hello",
            },
        ).json()["data"]["run_id"]

        response = client.get(f"/api/v1/runs/{run_id}", headers=auth_headers("different-user"))
        assert response.status_code == 404


def test_service_rejects_missing_internal_credential(settings) -> None:
    app = create_app(
        settings=settings,
        repository=InMemoryRunRepository(),
        adapter=FakeAgentCoreAdapter(),
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/harnesses", headers={"X-Harness-Engine-Subject": "test-user"})
        assert response.status_code == 401


def test_harness_overlay_can_be_removed_without_mutating_agent(settings) -> None:
    app = create_app(
        settings=settings,
        repository=InMemoryRunRepository(),
        adapter=FakeAgentCoreAdapter(),
    )
    with TestClient(app) as client:
        configure_agent(client)
        response = client.delete(
            "/api/v1/agents/agent-example/harness",
            headers=auth_headers(),
        )
        assert response.status_code == 200
        assert response.json()["data"]["deleted"] is True
        assert client.get(
            "/api/v1/agents/agent-example/harness",
            headers=auth_headers(),
        ).status_code == 404
