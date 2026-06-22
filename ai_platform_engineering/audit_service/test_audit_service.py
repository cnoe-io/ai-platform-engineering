from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

from ai_platform_engineering.audit_service.config import Settings
from ai_platform_engineering.audit_service.main import create_app
from ai_platform_engineering.audit_service.storage import AuditQuery, LocalAuditStore, S3AuditStore


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values = {
        "local_path": str(tmp_path),
        "local_gzip": True,
        "local_retention_days": 1,
        "queue_max_size": 10,
        "flush_batch_size": 2,
        "flush_interval_seconds": 0.05,
        "read_default_limit": 100,
        "read_max_limit": 500,
        "read_max_days": 7,
    }
    values.update(overrides)
    return Settings(**values)


def _wait_for_flushed(client: TestClient, expected: int) -> None:
    deadline = time.time() + 2
    while time.time() < deadline:
        status = client.get("/v1/audit/status").json()
        if status["flushed_events"] >= expected:
            return
        time.sleep(0.02)
    raise AssertionError(f"audit service did not flush {expected} events")


def test_ingests_batches_and_reads_filtered_events(tmp_path: Path) -> None:
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        response = client.post(
            "/v1/audit/events",
            json={
                "events": [
                    {
                        "ts": "2026-06-20T01:00:00Z",
                        "type": "openfga_rebac",
                        "component": "admin_ui",
                        "outcome": "allow",
                        "correlation_id": "corr-1",
                    },
                    {
                        "ts": "2026-06-20T01:01:00Z",
                        "type": "auth",
                        "component": "login",
                        "outcome": "deny",
                        "correlation_id": "corr-2",
                    },
                ]
            },
        )

        assert response.status_code == 202
        assert response.json()["accepted"] == 2
        _wait_for_flushed(client, 2)

        read = client.get(
            "/v1/audit/events",
            params={
                "since": "2026-06-20T00:00:00Z",
                "until": "2026-06-20T02:00:00Z",
                "type": "openfga_rebac",
            },
        )

        assert read.status_code == 200
        body = read.json()
        assert body["total"] == 1
        assert body["records"][0]["correlation_id"] == "corr-1"


def test_rejects_when_queue_is_full(tmp_path: Path) -> None:
    app = create_app(_settings(tmp_path, queue_max_size=1, flush_batch_size=10, flush_interval_seconds=10))
    with TestClient(app) as client:
        response = client.post(
            "/v1/audit/events",
            json={"events": [{"type": "auth"}, {"type": "auth"}]},
        )

        assert response.status_code == 503
        status = client.get("/v1/audit/status").json()
        assert status["rejected_events"] == 2


def test_accepts_single_event_payload_and_defaults_timestamp(tmp_path: Path) -> None:
    app = create_app(_settings(tmp_path, flush_batch_size=1))
    with TestClient(app) as client:
        response = client.post("/v1/audit/events", json={"type": "auth", "outcome": "allow"})

        assert response.status_code == 202
        _wait_for_flushed(client, 1)

        now_dt = datetime.now(timezone.utc)
        now = now_dt.isoformat().replace("+00:00", "Z")
        since = (now_dt.replace(microsecond=0) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
        read = client.get(
            "/v1/audit/events",
            params={
                "since": since,
                "until": now,
                "outcome": "allow",
            },
        )

        assert read.status_code == 200
        records = read.json()["records"]
        assert len(records) == 1
    assert records[0]["type"] == "auth"
    assert records[0]["audit_event_id"]


def test_settings_reads_local_retention_days(monkeypatch) -> None:
    monkeypatch.setenv("AUDIT_SERVICE_LOCAL_RETENTION_DAYS", "3")

    settings = Settings.from_env()

    assert settings.local_retention_days == 3


def test_local_store_purges_expired_audit_files(tmp_path: Path) -> None:
    store = LocalAuditStore(str(tmp_path), gzip_enabled=False)
    old_dir = tmp_path / "2026" / "06" / "18"
    recent_dir = tmp_path / "2026" / "06" / "20"
    old_dir.mkdir(parents=True)
    recent_dir.mkdir(parents=True)
    old_file = old_dir / "audit-20260618T000000Z-old.ndjson"
    recent_file = recent_dir / "audit-20260620T115959Z-recent.ndjson"
    old_file.write_text('{"type":"auth"}\n', encoding="utf-8")
    recent_file.write_text('{"type":"auth"}\n', encoding="utf-8")

    deleted = store.purge_expired(retention_days=1, now=datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc))

    assert deleted == 1
    assert not old_file.exists()
    assert recent_file.exists()
    assert not old_dir.exists()


def test_s3_store_writes_and_reads_parquet_objects(monkeypatch) -> None:
    class FakeS3Client:
        def __init__(self) -> None:
            self.objects: dict[str, bytes] = {}
            self.content_types: dict[str, str] = {}

        def head_bucket(self, *, Bucket: str) -> None:  # noqa: N803
            assert Bucket == "audit-bucket"

        def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str) -> None:  # noqa: N803
            assert Bucket == "audit-bucket"
            self.objects[Key] = Body
            self.content_types[Key] = ContentType

        def list_objects_v2(
            self,
            *,
            Bucket: str,
            Prefix: str,
            ContinuationToken: str | None = None,
            Delimiter: str | None = None,
        ) -> dict[str, object]:  # noqa: N803
            assert Bucket == "audit-bucket"
            assert Delimiter in (None, "/")
            return {
                "Contents": [{"Key": key} for key in sorted(self.objects) if key.startswith(Prefix)],
                "IsTruncated": False,
            }

        def get_object(self, *, Bucket: str, Key: str) -> dict[str, object]:  # noqa: N803
            assert Bucket == "audit-bucket"
            return {"Body": BytesIO(self.objects[Key])}

    fake_client = FakeS3Client()
    monkeypatch.setattr(S3AuditStore, "_build_client", lambda self: fake_client)

    store = S3AuditStore(bucket="audit-bucket", prefix="audit", region="us-east-1")
    path = store.write_batch(
        [
            {
                "ts": "2026-06-20T01:00:00Z",
                "type": "auth",
                "component": "admin_ui",
                "outcome": "allow",
                "correlation_id": "corr-1",
                "subject_hash": "sha256:alice",
                "subject_ref": "user:alice",
                "actor_ref": "user:alice",
            }
        ]
    )

    assert path is not None
    key = path.removeprefix("s3://audit-bucket/")
    assert key.startswith("audit/2026/06/20/01/00/")
    assert key.endswith(".parquet")
    assert fake_client.content_types[key] == "application/vnd.apache.parquet"

    result = store.query(
        AuditQuery(
            since=datetime(2026, 6, 20, 0, 0, tzinfo=timezone.utc),
            until=datetime(2026, 6, 20, 2, 0, tzinfo=timezone.utc),
            limit=10,
            outcome="allow",
        )
    )

    assert result.total == 1
    assert result.records[0]["correlation_id"] == "corr-1"
    assert result.records[0]["subject_ref"] == "user:alice"
    assert result.records[0]["actor_ref"] == "user:alice"
