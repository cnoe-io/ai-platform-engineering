# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6
"""Unit tests for audit log storage backends."""

import json
from datetime import datetime, timezone
from unittest import mock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(**overrides):
    base = {
        "ts": datetime(2026, 6, 18, 12, 0, 0, tzinfo=timezone.utc),
        "type": "auth",
        "tenant_id": "default",
        "subject_hash": "sha256:abc",
        "action": "admin_ui#view",
        "outcome": "allow",
        "correlation_id": "corr-001",
        "source": "webui_backend",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# LocalBackend
# ---------------------------------------------------------------------------

class TestLocalBackend:
    def test_creates_file_at_correct_path(self, tmp_path):
        from ai_platform_engineering.utils.audit_backends.local_backend import LocalBackend

        backend = LocalBackend(path=str(tmp_path))
        event = _make_event()
        backend.write(event)

        files = list(tmp_path.rglob("*.ndjson"))
        assert len(files) == 1
        assert "2026/06/18" in str(files[0])
        assert files[0].name.startswith("auth-20260618-")

    def test_appends_on_second_write(self, tmp_path):
        from ai_platform_engineering.utils.audit_backends.local_backend import LocalBackend

        backend = LocalBackend(path=str(tmp_path))
        backend.write(_make_event())
        backend.write(_make_event(action="admin_ui#export"))

        files = list(tmp_path.rglob("*.ndjson"))
        assert len(files) == 1
        lines = files[0].read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 2

    def test_creates_directory_automatically(self, tmp_path):
        from ai_platform_engineering.utils.audit_backends.local_backend import LocalBackend

        nested = tmp_path / "deep" / "nested"
        backend = LocalBackend(path=str(nested))
        backend.write(_make_event())

        files = list(nested.rglob("*.ndjson"))
        assert len(files) == 1

    def test_write_error_is_caught_and_does_not_raise(self, tmp_path):
        from ai_platform_engineering.utils.audit_backends.local_backend import LocalBackend

        backend = LocalBackend(path=str(tmp_path))
        with mock.patch("builtins.open", side_effect=OSError("disk full")):
            # Must not raise
            backend.write(_make_event())

    def test_datetime_serialised_as_iso_string(self, tmp_path):
        from ai_platform_engineering.utils.audit_backends.local_backend import LocalBackend

        backend = LocalBackend(path=str(tmp_path))
        backend.write(_make_event())

        files = list(tmp_path.rglob("*.ndjson"))
        data = json.loads(files[0].read_text(encoding="utf-8").strip())
        assert isinstance(data["ts"], str)
        assert "2026-06-18" in data["ts"]


# ---------------------------------------------------------------------------
# S3Backend (buffered Parquet)
# ---------------------------------------------------------------------------

class TestS3Backend:
    def test_buffers_events_and_flushes_parquet_on_batch_size(self):
        from ai_platform_engineering.utils.audit_backends.s3_backend import S3Backend

        with mock.patch(
            "ai_platform_engineering.utils.audit_backends.s3_backend.S3Backend._build_client"
        ) as mock_build:
            mock_client = mock.MagicMock()
            mock_build.return_value = mock_client

            backend = S3Backend(
                bucket="my-bucket",
                prefix="audit",
                flush_interval=9999,
                flush_batch_size=2,
            )
            backend.write(_make_event())
            # Not flushed yet
            mock_client.put_object.assert_not_called()

            backend.write(_make_event(action="admin_ui#export"))
            # Batch of 2 → flush triggered
            mock_client.put_object.assert_called_once()

            call_kwargs = mock_client.put_object.call_args.kwargs
            assert call_kwargs["Bucket"] == "my-bucket"
            key = call_kwargs["Key"]
            assert key.startswith("audit/")
            assert key.endswith(".parquet")
            assert call_kwargs["ContentType"] == "application/octet-stream"

    def test_s3_error_is_caught_and_does_not_raise(self):
        from ai_platform_engineering.utils.audit_backends.s3_backend import S3Backend

        with mock.patch(
            "ai_platform_engineering.utils.audit_backends.s3_backend.S3Backend._build_client"
        ) as mock_build:
            mock_client = mock.MagicMock()
            mock_client.put_object.side_effect = Exception("network error")
            mock_build.return_value = mock_client

            backend = S3Backend(bucket="my-bucket", flush_interval=9999, flush_batch_size=1)
            # Must not raise even when S3 throws
            backend.write(_make_event())

    def test_endpoint_url_passed_to_boto3(self):
        from ai_platform_engineering.utils.audit_backends.s3_backend import S3Backend

        with mock.patch("boto3.client") as mock_boto3:
            mock_boto3.return_value = mock.MagicMock()
            S3Backend(
                bucket="minio-bucket",
                endpoint_url="http://localhost:9000",
                flush_interval=9999,
            )
            mock_boto3.assert_called_once_with(
                "s3",
                region_name=mock.ANY,
                endpoint_url="http://localhost:9000",
            )
