"""Tests for per-datasource RBAC on the job family of endpoints.

The job endpoints previously only enforced the coarse READONLY/INGESTONLY/
ADMIN role, letting any authenticated ingestor read or mutate jobs belonging
to a datasource owned by a different team. Every endpoint below now resolves
the job's ``datasource_id`` (already stored on ``JobInfo``) and calls
``check_datasource_access(..., "ingest")`` before touching job state.

``POST /v1/jobs/batch`` is the one exception: it filters the requested
datasource IDs down to the caller's accessible set instead of 403-ing,
matching the silent-exclusion pattern used by ``/v1/datasources`` and
``/v1/query`` (it exists specifically to poll many datasources at once, so a
blanket 403 on a single inaccessible ID would defeat the endpoint's purpose).

The TestClient is used WITHOUT a ``with`` block so the app lifespan (Milvus /
Redis / Neo4j connections) is not triggered.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from common.job_manager import JobInfo, JobStatus
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


def _job(job_id: str = "job-1", datasource_id: str = "primary-ds") -> JobInfo:
    return JobInfo(job_id=job_id, status=JobStatus.IN_PROGRESS, created_at=0, datasource_id=datasource_id)


def _allow():
    async def _ok(*args, **kwargs):
        return None

    return _ok


def _deny(status_code: int = 403, detail: str = "Access denied for this datasource"):
    async def _raise(*args, **kwargs):
        raise HTTPException(status_code=status_code, detail=detail)

    return _raise


@pytest.fixture
def client() -> TestClient:
    return TestClient(restapi.app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _wire(monkeypatch: pytest.MonkeyPatch):
    restapi.app.dependency_overrides[require_authenticated_user] = lambda: _user(role=Role.INGESTONLY)
    jm = AsyncMock()
    monkeypatch.setattr(restapi, "jobmanager", jm, raising=False)
    monkeypatch.setattr(restapi, "metadata_storage", AsyncMock(), raising=False)
    yield jm
    restapi.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# GET /v1/job/{job_id}
# ---------------------------------------------------------------------------


def test_get_job_denied_returns_403(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _wire.get_job.return_value = _job(datasource_id="secondary-ds")
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.get("/v1/job/job-1")

    assert response.status_code == 403


def test_get_job_allowed_returns_job(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _wire.get_job.return_value = _job()
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)

    response = client.get("/v1/job/job-1")

    assert response.status_code == 200
    assert response.json()["job_id"] == "job-1"


def test_get_job_checks_ingest_scope_for_jobs_datasource(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    calls = []

    async def _spy(request, user, datasource_id, scope):
        calls.append((datasource_id, scope))

    _wire.get_job.return_value = _job(datasource_id="primary-ds")
    monkeypatch.setattr(restapi, "check_datasource_access", _spy, raising=False)

    client.get("/v1/job/job-1")

    assert calls == [("primary-ds", "ingest")]


def test_get_job_404_before_authz_when_missing(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    calls = []

    async def _spy(*args, **kwargs):
        calls.append(args)

    _wire.get_job.return_value = None
    monkeypatch.setattr(restapi, "check_datasource_access", _spy, raising=False)

    response = client.get("/v1/job/missing-job")

    assert response.status_code == 404
    assert calls == []


# ---------------------------------------------------------------------------
# GET /v1/jobs/datasource/{datasource_id}
# ---------------------------------------------------------------------------


def test_get_jobs_by_datasource_denied_returns_403(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.get("/v1/jobs/datasource/secondary-ds")

    assert response.status_code == 403
    _wire.get_jobs_by_datasource.assert_not_awaited()


def test_get_jobs_by_datasource_allowed_returns_jobs(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)
    _wire.get_jobs_by_datasource.return_value = [_job()]

    response = client.get("/v1/jobs/datasource/primary-ds")

    assert response.status_code == 200


# ---------------------------------------------------------------------------
# POST /v1/jobs/batch (filters, does not 403)
# ---------------------------------------------------------------------------


def test_jobs_batch_filters_out_inaccessible_datasources(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(restapi, "RBAC_TEAM_SCOPE_ENABLED", True, raising=False)

    async def _accessible(*args, **kwargs):
        return ["primary-ds"]

    monkeypatch.setattr(restapi, "get_accessible_datasource_ids", _accessible, raising=False)

    async def _team(*args, **kwargs):
        return None

    monkeypatch.setattr(restapi, "derive_team_for_request", _team, raising=False)
    _wire.get_jobs_batch.return_value = {"primary-ds": [_job()]}

    response = client.post("/v1/jobs/batch", json={"datasource_ids": ["primary-ds", "secondary-ds"]})

    assert response.status_code == 200
    assert response.json()["datasource_count"] == 1
    _wire.get_jobs_batch.assert_awaited_once()
    _, kwargs = _wire.get_jobs_batch.call_args
    assert kwargs["datasource_ids"] == ["primary-ds"]


def test_jobs_batch_unrestricted_when_team_scope_disabled(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(restapi, "RBAC_TEAM_SCOPE_ENABLED", False, raising=False)
    _wire.get_jobs_batch.return_value = {"primary-ds": [_job()], "secondary-ds": [_job(datasource_id="secondary-ds")]}

    response = client.post("/v1/jobs/batch", json={"datasource_ids": ["primary-ds", "secondary-ds"]})

    assert response.status_code == 200
    assert response.json()["datasource_count"] == 2


# ---------------------------------------------------------------------------
# POST /v1/job (create)
# ---------------------------------------------------------------------------


def test_create_job_denied_returns_403_and_does_not_create(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    restapi.metadata_storage.get_datasource_info.return_value = object()
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.post("/v1/job", params={"datasource_id": "secondary-ds"})

    assert response.status_code == 403
    _wire.upsert_job.assert_not_awaited()


def test_create_job_allowed_creates_job(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    restapi.metadata_storage.get_datasource_info.return_value = object()
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)
    _wire.upsert_job.return_value = True

    response = client.post("/v1/job", params={"datasource_id": "primary-ds"})

    assert response.status_code == 201
    _wire.upsert_job.assert_awaited_once()


# ---------------------------------------------------------------------------
# PATCH /v1/job/{job_id}
# ---------------------------------------------------------------------------


def test_update_job_denied_returns_403_and_does_not_update(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _wire.get_job.return_value = _job(datasource_id="secondary-ds")
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.patch("/v1/job/job-1")

    assert response.status_code == 403
    _wire.upsert_job.assert_not_awaited()


def test_update_job_allowed_updates_job(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _wire.get_job.return_value = _job()
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)
    _wire.upsert_job.return_value = True

    response = client.patch("/v1/job/job-1")

    assert response.status_code == 200


# ---------------------------------------------------------------------------
# POST /v1/job/{job_id}/terminate
# ---------------------------------------------------------------------------


def test_terminate_job_denied_returns_403(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    restapi.app.dependency_overrides[require_authenticated_user] = lambda: _user(role=Role.ADMIN)
    _wire.get_job.return_value = _job(datasource_id="secondary-ds")
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.post("/v1/job/job-1/terminate")

    assert response.status_code == 403
    _wire.terminate_job.assert_not_awaited()


def test_terminate_job_allowed_terminates(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    restapi.app.dependency_overrides[require_authenticated_user] = lambda: _user(role=Role.ADMIN)
    _wire.get_job.return_value = _job()
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)
    _wire.terminate_job.return_value = True

    response = client.post("/v1/job/job-1/terminate")

    assert response.status_code == 200


# ---------------------------------------------------------------------------
# POST /v1/job/{job_id}/increment-progress|increment-failure|increment-document-count|add-errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "manager_attr"),
    [
        ("/v1/job/job-1/increment-progress", "increment_progress"),
        ("/v1/job/job-1/increment-failure", "increment_failure"),
        ("/v1/job/job-1/increment-document-count", "increment_document_count"),
    ],
)
def test_job_mutation_endpoint_denied_returns_403(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch, path: str, manager_attr: str):
    _wire.get_job.return_value = _job(datasource_id="secondary-ds")
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.post(path)

    assert response.status_code == 403
    getattr(_wire, manager_attr).assert_not_awaited()


@pytest.mark.parametrize(
    ("path", "manager_attr"),
    [
        ("/v1/job/job-1/increment-progress", "increment_progress"),
        ("/v1/job/job-1/increment-failure", "increment_failure"),
        ("/v1/job/job-1/increment-document-count", "increment_document_count"),
    ],
)
def test_job_mutation_endpoint_allowed_calls_jobmanager(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch, path: str, manager_attr: str):
    _wire.get_job.return_value = _job()
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)
    getattr(_wire, manager_attr).return_value = 1

    response = client.post(path)

    assert response.status_code == 200
    getattr(_wire, manager_attr).assert_awaited_once()


def test_add_job_errors_denied_returns_403(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _wire.get_job.return_value = _job(datasource_id="secondary-ds")
    monkeypatch.setattr(restapi, "check_datasource_access", _deny(), raising=False)

    response = client.post("/v1/job/job-1/add-errors", json=["boom"])

    assert response.status_code == 403
    _wire.add_error_msg.assert_not_awaited()


def test_add_job_errors_allowed_adds_errors(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    _wire.get_job.return_value = _job()
    monkeypatch.setattr(restapi, "check_datasource_access", _allow(), raising=False)
    _wire.add_error_msg.return_value = 1

    response = client.post("/v1/job/job-1/add-errors", json=["boom"])

    assert response.status_code == 200
    _wire.add_error_msg.assert_awaited_once()


def test_add_job_errors_404_before_authz_when_job_missing(client: TestClient, _wire, monkeypatch: pytest.MonkeyPatch):
    calls = []

    async def _spy(*args, **kwargs):
        calls.append(args)

    _wire.get_job.return_value = None
    monkeypatch.setattr(restapi, "check_datasource_access", _spy, raising=False)

    response = client.post("/v1/job/missing-job/add-errors", json=["boom"])

    assert response.status_code == 404
    assert calls == []
