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


def _render(values: dict) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "helm",
            "template",
            "test",
            str(CHART),
            "--namespace",
            "default",
            "--set",
            "tags.caipe-ui=true",
            "--set-json",
            f"caipe-ui.webexBots={json.dumps(values.get('webexBots', []))}",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_renders_webex_bot_catalog_without_tokens() -> None:
    result = _render({
        "webexBots": [
            {"id": "primary", "name": "Primary bot", "tokenEnv": "PRIMARY_BOT_TOKEN"},
            {"id": "secondary", "name": "Secondary bot", "tokenEnv": "SECONDARY_BOT_TOKEN"},
        ],
    })

    assert result.returncode == 0, result.stderr
    documents = [doc for doc in yaml.safe_load_all(result.stdout) if doc]
    config = next(
        doc for doc in documents
        if doc.get("kind") == "ConfigMap" and doc.get("metadata", {}).get("name") == "test-caipe-ui-config"
    )
    catalog = json.loads(config["data"]["WEBEX_INTEGRATION_BOTS_JSON"])
    assert catalog == [
        {"id": "primary", "name": "Primary bot", "tokenEnv": "PRIMARY_BOT_TOKEN"},
        {"id": "secondary", "name": "Secondary bot", "tokenEnv": "SECONDARY_BOT_TOKEN"},
    ]


def test_rejects_inline_webex_bot_token() -> None:
    result = _render({
        "webexBots": [
            {
                "id": "primary",
                "name": "Primary bot",
                "tokenEnv": "PRIMARY_BOT_TOKEN",
                "token": "plaintext-must-not-render",
            },
        ],
    })

    assert result.returncode != 0
    assert "cannot contain an inline token" in result.stderr
    assert "plaintext-must-not-render" not in result.stdout
