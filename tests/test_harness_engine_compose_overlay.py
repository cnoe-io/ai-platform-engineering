from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "docker-compose.caipe-oss.yaml"
NGINX = ROOT / "deploy" / "caipe-oss-nginx.conf"


def test_preview_overlay_adds_harness_engine_without_overriding_dynamic_agents() -> None:
    services = yaml.safe_load(OVERLAY.read_text(encoding="utf-8"))["services"]

    assert "dynamic-agents" not in services
    assert services["harness-engine"]["build"]["dockerfile"] == (
        "ai_platform_engineering/harness_engine/build/Dockerfile"
    )
    assert services["harness-engine"]["environment"]["HARNESS_ENGINE_STORAGE_BACKEND"] == (
        "mongodb"
    )
    assert services["caipe-ui"]["environment"]["HARNESS_ENGINE_URL"] == (
        "http://harness-engine:8010"
    )


def test_preview_nginx_exposes_ui_but_not_harness_engine_directly() -> None:
    config = NGINX.read_text(encoding="utf-8")

    assert "server_name caipe-oss.outshift.io;" in config
    assert "proxy_pass http://caipe-ui:3000;" in config
    assert "proxy_pass http://harness-engine:8010;" not in config

