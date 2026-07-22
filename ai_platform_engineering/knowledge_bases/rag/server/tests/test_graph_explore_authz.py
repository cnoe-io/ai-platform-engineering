"""Tests for per-datasource filtering on the data-graph explore endpoints.

``/v1/graph/explore/data/*`` previously returned entities and relations from
every datasource once a caller cleared the coarse READONLY role. These
endpoints now resolve the caller's accessible-datasource set ONCE per
request (``_get_accessible_datasource_ids_for_request``) and silently drop
entities/relations tagged with an inaccessible ``_datasource_id`` — matching
the filtering pattern ``/v1/query`` already uses, rather than 403-ing a
list/batch response. The single-entity neighborhood endpoint additionally
403s on the *starting* entity, since fetching one specific entity by ID is
more like a by-ID content read than a list.

``/v1/graph/explore/entity_type`` and the whole ``/v1/graph/explore/ontology/*``
family are intentionally left unfiltered (schema/type-level metadata, not
per-datasource instance data) and are not covered here.

The TestClient is used WITHOUT a ``with`` block so the app lifespan (Milvus /
Redis / Neo4j connections) is not triggered.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from common.models.rag import StructuredEntity, StructuredEntityId
from common.models.graph import Relation
from common.models.rbac import Role, UserContext
from server import restapi
from server.rbac import require_authenticated_user


def _user(role: str = Role.READONLY, subject: str = "primary-sub") -> UserContext:
    return UserContext(
        subject=subject,
        email="primary@example.com",
        role=role,
        is_authenticated=True,
        groups=[],
    )


def _entity(pk: str, datasource_id: str | None, entity_type: str = "Widget") -> StructuredEntity:
    props: dict = {"id": pk}
    if datasource_id is not None:
        props["_datasource_id"] = datasource_id
    return StructuredEntity(entity_type=entity_type, all_properties=props, primary_key_properties=["id"])


def _relation(from_pk: str, to_pk: str, entity_type: str = "Widget") -> Relation:
    return Relation(
        from_entity=StructuredEntityId(entity_type=entity_type, primary_key=from_pk),
        to_entity=StructuredEntityId(entity_type=entity_type, primary_key=to_pk),
        relation_name="relates_to",
        relation_pk="rel-1",
        relation_properties={},
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(restapi.app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _wire(monkeypatch: pytest.MonkeyPatch):
    restapi.app.dependency_overrides[require_authenticated_user] = lambda: _user()
    graph_db = AsyncMock()
    monkeypatch.setattr(restapi, "data_graph_db", graph_db, raising=False)
    yield graph_db
    restapi.app.dependency_overrides.clear()


def _restrict_to(monkeypatch: pytest.MonkeyPatch, accessible: list[str] | None) -> None:
    """Force `_get_accessible_datasource_ids_for_request` to a fixed result."""

    async def _resolved(*args, **kwargs):
        return accessible

    monkeypatch.setattr(restapi, "_get_accessible_datasource_ids_for_request", _resolved, raising=False)


# ---------------------------------------------------------------------------
# GET /v1/graph/explore/data/entities/batch
# ---------------------------------------------------------------------------


def test_entities_batch_filters_out_inaccessible_datasource(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, ["primary-ds"])
    _wire.fetch_entities_batch.return_value = [
        _entity("e1", "primary-ds"),
        _entity("e2", "secondary-ds"),
    ]

    response = client.get("/v1/graph/explore/data/entities/batch")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["entities"][0]["all_properties"]["id"] == "e1"


def test_entities_batch_keeps_untagged_entities(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, ["primary-ds"])
    _wire.fetch_entities_batch.return_value = [_entity("e1", None)]

    response = client.get("/v1/graph/explore/data/entities/batch")

    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_entities_batch_unrestricted_when_accessible_is_none(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, None)
    _wire.fetch_entities_batch.return_value = [
        _entity("e1", "primary-ds"),
        _entity("e2", "secondary-ds"),
    ]

    response = client.get("/v1/graph/explore/data/entities/batch")

    assert response.status_code == 200
    assert response.json()["count"] == 2


# ---------------------------------------------------------------------------
# GET /v1/graph/explore/data/relations/batch
# ---------------------------------------------------------------------------


def test_relations_batch_filters_by_endpoint_datasource(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, ["primary-ds"])
    _wire.fetch_relations_batch.return_value = [_relation("e1", "e2"), _relation("e3", "e4")]

    async def _fetch_entity(entity_type: str, primary_key: str):
        mapping = {
            "e1": _entity("e1", "primary-ds"),
            "e2": _entity("e2", "primary-ds"),
            "e3": _entity("e3", "secondary-ds"),
            "e4": _entity("e4", "primary-ds"),
        }
        return mapping.get(primary_key)

    _wire.fetch_entity.side_effect = _fetch_entity

    response = client.get("/v1/graph/explore/data/relations/batch")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["relations"][0]["from_entity"]["primary_key"] == "e1"


def test_relations_batch_unrestricted_when_accessible_is_none(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, None)
    _wire.fetch_relations_batch.return_value = [_relation("e1", "e2"), _relation("e3", "e4")]

    response = client.get("/v1/graph/explore/data/relations/batch")

    assert response.status_code == 200
    assert response.json()["count"] == 2
    _wire.fetch_entity.assert_not_called()


# ---------------------------------------------------------------------------
# POST /v1/graph/explore/data/entity/neighborhood
# ---------------------------------------------------------------------------


def test_neighborhood_denies_inaccessible_start_entity(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    start = _entity("e1", "secondary-ds")
    _wire.explore_neighborhood.return_value = {"entity": start, "entities": [start], "relations": []}

    async def _deny(*args, **kwargs):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Access denied for this datasource")

    monkeypatch.setattr(restapi, "check_datasource_access", _deny, raising=False)

    response = client.post(
        "/v1/graph/explore/data/entity/neighborhood",
        json={"entity_type": "Widget", "entity_pk": "e1", "depth": 1},
    )

    assert response.status_code == 403


def test_neighborhood_filters_neighbors_and_relations(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    start = _entity("e1", "primary-ds")
    neighbor_ok = _entity("e2", "primary-ds")
    neighbor_denied = _entity("e3", "secondary-ds")
    _wire.explore_neighborhood.return_value = {
        "entity": start,
        "entities": [start, neighbor_ok, neighbor_denied],
        "relations": [_relation("e1", "e2"), _relation("e1", "e3")],
    }

    async def _allow(*args, **kwargs):
        return None

    monkeypatch.setattr(restapi, "check_datasource_access", _allow, raising=False)
    _restrict_to(monkeypatch, ["primary-ds"])

    async def _fetch_entity(entity_type: str, primary_key: str):
        mapping = {"e1": start, "e2": neighbor_ok, "e3": neighbor_denied}
        return mapping.get(primary_key)

    _wire.fetch_entity.side_effect = _fetch_entity

    response = client.post(
        "/v1/graph/explore/data/entity/neighborhood",
        json={"entity_type": "Widget", "entity_pk": "e1", "depth": 1},
    )

    assert response.status_code == 200
    body = response.json()
    entity_ids = {e["all_properties"]["id"] for e in body["entities"]}
    assert entity_ids == {"e1", "e2"}
    assert len(body["relations"]) == 1


def test_neighborhood_404_when_start_entity_missing(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    calls = []

    async def _spy(*args, **kwargs):
        calls.append(args)

    monkeypatch.setattr(restapi, "check_datasource_access", _spy, raising=False)
    _wire.explore_neighborhood.return_value = {"entity": None, "entities": [], "relations": []}

    response = client.post(
        "/v1/graph/explore/data/entity/neighborhood",
        json={"entity_type": "Widget", "entity_pk": "missing", "depth": 1},
    )

    assert response.status_code == 404
    assert calls == []


# ---------------------------------------------------------------------------
# GET /v1/graph/explore/data/entity/start
# ---------------------------------------------------------------------------


def test_random_start_nodes_filters_out_inaccessible(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, ["primary-ds"])
    _wire.fetch_random_entities.return_value = [
        _entity("e1", "primary-ds"),
        _entity("e2", "secondary-ds"),
    ]

    response = client.get("/v1/graph/explore/data/entity/start", params={"n": 10})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["all_properties"]["id"] == "e1"


def test_random_start_nodes_unrestricted_fetches_exact_count(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _restrict_to(monkeypatch, None)
    _wire.fetch_random_entities.return_value = [_entity("e1", "primary-ds")]

    response = client.get("/v1/graph/explore/data/entity/start", params={"n": 5})

    assert response.status_code == 200
    _wire.fetch_random_entities.assert_awaited_once_with(count=5)
