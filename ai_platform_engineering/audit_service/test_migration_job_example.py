"""Execute the documented apply block with a fake kubectl; never contact a cluster."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml


def example() -> str:
    readme = Path(__file__).with_name("README.md").read_text()
    match = re.search(r"```bash\n(# CAS audit Kubernetes migration:.*?\n)```", readme, re.DOTALL)
    assert match, "The copy-paste Kubernetes apply command must remain documented"
    return match.group(1)


def configured_example(mode: str, name: str = "caipe-audit-migrate-check") -> str:
    replacements = {
        "REPLACE_WITH_CONTEXT": "example-context",
        "REPLACE_WITH_NAMESPACE": "example-namespace",
        "REPLACE_WITH_CAS_RELEASE": "example-release",
        "REPLACE_WITH_DIGEST": "a" * 64,
        "REPLACE_WITH_ARCHIVE_READER_SERVICE_ACCOUNT": "example-audit-reader",
        "REPLACE_WITH_MONGODB_SECRET": "example-mongodb",
        "REPLACE_WITH_DATABASE": "example",
        "REPLACE_WITH_ARCHIVE_BUCKET": "example-archive",
        "REPLACE_WITH_ARCHIVE_PREFIX": "archive",
        "REPLACE_WITH_REGION": "us-east-1",
        "REPLACE_WITH_UTC_START": "2026-01-01T00:00:00Z",
        "REPLACE_WITH_UTC_END": "2026-01-08T00:00:00Z",
    }
    command = example()
    # Replace assignment values, not the placeholder guard's pattern.
    lines = command.splitlines()
    for index, line in enumerate(lines):
        if not line.startswith("AUDIT_"):
            continue
        for placeholder, value in replacements.items():
            line = line.replace(placeholder, value)
        lines[index] = line
    return "\n".join(lines).replace("AUDIT_MODE='dry-run'", f"AUDIT_MODE='{mode}'").replace(
        "AUDIT_JOB_NAME='caipe-audit-migrate-check'", f"AUDIT_JOB_NAME='{name}'"
    )


def run_example(command: str, root: Path) -> tuple[subprocess.CompletedProcess[str], Path]:
    capture = root / "captured.json"
    kubectl = root / "kubectl"
    kubectl.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "with open(os.environ['AUDIT_EXAMPLE_CAPTURE'], 'w') as output:\n"
        "    json.dump({'argv': sys.argv[1:], 'manifest': sys.stdin.read()}, output)\n"
    )
    kubectl.chmod(0o700)
    result = subprocess.run(
        ["/bin/bash", "-c", command], capture_output=True, text=True, check=False,
        env={**os.environ, "PATH": str(root), "AUDIT_EXAMPLE_CAPTURE": str(capture)},
    )
    return result, capture


@pytest.mark.parametrize(("mode", "name"), [
    ("dry-run", "caipe-audit-migrate-check"),
    ("apply", "caipe-audit-migrate-initial"),
    ("apply", "caipe-audit-migrate-final"),
])
def test_documented_command_applies_only_a_configured_job(mode: str, name: str, tmp_path: Path) -> None:
    result, capture = run_example(configured_example(mode, name), tmp_path)
    assert result.returncode == 0, result.stderr
    call = json.loads(capture.read_text())
    assert call["argv"] == ["--context", "example-context", "--namespace", "example-namespace", "apply", "-f", "-"]
    job: dict[str, Any] = yaml.safe_load(call["manifest"])
    assert job["apiVersion"] == "batch/v1" and job["kind"] == "Job"
    assert job["metadata"] == {"name": name}
    assert job["spec"]["backoffLimit"] == 0
    assert job["spec"]["activeDeadlineSeconds"] == 7200
    assert not job["spec"].get("ttlSecondsAfterFinished")  # Retain inspection evidence.
    pod = job["spec"]["template"]["spec"]
    assert pod["serviceAccountName"] == "example-audit-reader"
    assert pod["restartPolicy"] == "Never" and pod["automountServiceAccountToken"] is False
    assert job["spec"]["template"]["metadata"]["labels"]["app.kubernetes.io/name"] != "audit-service"
    container = pod["containers"][0]
    assert container["image"] == "ghcr.io/caipe-io/caipe-audit-service:example-release@sha256:" + "a" * 64
    assert container["command"] == ["python", "-m", "ai_platform_engineering.audit_service.scripts.cas_migration.migrate_query_store"]
    assert container["args"] == ["--since", "2026-01-01T00:00:00Z", "--until", "2026-01-08T00:00:00Z"] + (["--apply"] if mode == "apply" else [])
    env = {entry["name"]: entry for entry in container["env"]}
    assert env["AUDIT_SERVICE_MONGODB_URI"] == {"name": "AUDIT_SERVICE_MONGODB_URI", "valueFrom": {"secretKeyRef": {"name": "example-mongodb", "key": "MONGODB_URI"}}}
    assert env["AUDIT_SERVICE_BACKEND"]["value"] == "s3"
    assert env["AUDIT_SERVICE_S3_BUCKET"]["value"] == "example-archive"
    assert env["AUDIT_SERVICE_QUERY_RETENTION_DAYS"]["value"] == "7"


@pytest.mark.parametrize("command", [example(), configured_example("unsupported")])
def test_placeholders_and_unknown_modes_never_call_kubectl(command: str, tmp_path: Path) -> None:
    result, capture = run_example(command, tmp_path)
    assert result.returncode != 0
    assert not capture.exists()
