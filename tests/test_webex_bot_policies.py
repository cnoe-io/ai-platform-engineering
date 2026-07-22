from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "charts" / "ai-platform-engineering"


pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm is required")


def _render(bots: list[dict[str, object]]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "helm",
            "template",
            "test",
            str(CHART),
            "--namespace",
            "default",
            "--set",
            "tags.webex-bot=true",
            "--set-json",
            f"webex-bot.bots={json.dumps(bots)}",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def _allowlist_bot() -> dict[str, object]:
    return {
        "id": "primary",
        "name": "Primary bot",
        "tokenEnv": "PRIMARY_BOT_TOKEN",
        "spaces": {"accessMode": "allowlist"},
        "directMessages": {"accessMode": "allowlist"},
    }


def test_renders_runtime_owned_bot_policy_without_token_values() -> None:
    bot = {
        **_allowlist_bot(),
        "spaces": {
            "accessMode": "all_spaces",
            "defaultTeamSlug": "platform",
            "defaultAgentId": "agent-space",
        },
        "directMessages": {
            "accessMode": "all_users",
            "defaultAgentId": "agent-dm",
        },
    }
    result = _render([bot])

    assert result.returncode == 0, result.stderr
    documents = [doc for doc in yaml.safe_load_all(result.stdout) if doc]
    config = next(
        doc
        for doc in documents
        if doc.get("kind") == "ConfigMap"
        and "WEBEX_INTEGRATION_BOTS_JSON" in doc.get("data", {})
    )
    assert json.loads(config["data"]["WEBEX_INTEGRATION_BOTS_JSON"]) == [bot]


def test_allowlist_modes_do_not_require_defaults() -> None:
    result = _render([_allowlist_bot()])

    assert result.returncode == 0, result.stderr


def test_all_users_requires_only_a_default_agent() -> None:
    bot = {
        **_allowlist_bot(),
        "directMessages": {
            "accessMode": "all_users",
            "defaultAgentId": "agent-dm",
        },
    }
    result = _render([bot])

    assert result.returncode == 0, result.stderr


def test_rejects_all_users_without_default_agent() -> None:
    bot = {**_allowlist_bot(), "directMessages": {"accessMode": "all_users"}}
    result = _render([bot])

    assert result.returncode != 0
    assert "directMessages.defaultAgentId is required" in result.stderr


def test_rejects_all_spaces_without_space_defaults() -> None:
    bot = {**_allowlist_bot(), "spaces": {"accessMode": "all_spaces"}}
    result = _render([bot])

    assert result.returncode != 0
    assert "spaces.defaultTeamSlug is required" in result.stderr


def test_rejects_inline_webex_bot_token() -> None:
    bot = {**_allowlist_bot(), "token": "plaintext-must-not-render"}
    result = _render([bot])

    assert result.returncode != 0
    assert "inline tokens are forbidden" in result.stderr
    assert "plaintext-must-not-render" not in result.stdout
