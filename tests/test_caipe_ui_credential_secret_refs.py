"""Helm coverage for declarative CAIPE UI credential secrets."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
CHART = REPO_ROOT / "charts" / "ai-platform-engineering" / "charts" / "caipe-ui"


def _render(values: dict) -> subprocess.CompletedProcess[str]:
    base_values = {
        "global": {
            "vpa": {"enabled": False},
            "agentgateway": {"enabled": False},
            "image": {"tag": "test"},
        },
        "oktaSync": {"enabled": False},
    }
    base_values.update(values)
    return subprocess.run(
        ["helm", "template", "credential-test", str(CHART), "-f", "-"],
        input=yaml.safe_dump(base_values),
        text=True,
        capture_output=True,
        check=False,
    )


def _documents(rendered: str) -> list[dict]:
    return [document for document in yaml.safe_load_all(rendered) if document]


def test_renders_secret_ref_descriptor_without_plaintext() -> None:
    descriptor = {
        "id": "shared-webex-bot-token",
        "name": "Shared Webex bot token",
        "type": "bearer_token",
        "valueEnv": "SHARED_WEBEX_BOT_TOKEN",
        "owner": {"type": "team", "id": "platform-admins"},
        "sharedWithTeams": ["platform-users"],
    }
    result = _render(
        {
            "credentialSecretRefs": [descriptor],
            "existingSecret": "caipe-ui-secrets",
        }
    )

    assert result.returncode == 0, result.stderr
    config_map = next(
        document
        for document in _documents(result.stdout)
        if document["kind"] == "ConfigMap"
        and document["metadata"]["name"].endswith("-caipe-ui-config")
    )
    assert json.loads(
        config_map["data"]["CREDENTIAL_BOOTSTRAP_SECRET_REFS_JSON"]
    ) == [descriptor]
    assert "SHARED_WEBEX_BOT_TOKEN" in result.stdout
    assert "bot-token-plaintext" not in result.stdout


def test_rejects_inline_secret_values() -> None:
    result = _render(
        {
            "credentialSecretRefs": [
                {
                    "id": "shared-webex-bot-token",
                    "name": "Shared Webex bot token",
                    "type": "bearer_token",
                    "valueEnv": "SHARED_WEBEX_BOT_TOKEN",
                    "value": "bot-token-plaintext",
                    "owner": {"type": "team", "id": "platform-admins"},
                }
            ]
        }
    )

    assert result.returncode != 0
    assert "cannot contain an inline secret" in result.stderr


def test_rejects_unsupported_owner_type() -> None:
    result = _render(
        {
            "credentialSecretRefs": [
                {
                    "id": "shared-webex-bot-token",
                    "name": "Shared Webex bot token",
                    "type": "bearer_token",
                    "valueEnv": "SHARED_WEBEX_BOT_TOKEN",
                    "owner": {"type": "organization", "id": "caipe"},
                }
            ]
        }
    )

    assert result.returncode != 0
    assert "owner.type must be team or user" in result.stderr
