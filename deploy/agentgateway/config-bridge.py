#!/usr/bin/env python3
"""
AG Config Bridge — syncs CEL policies from MongoDB to Agent Gateway config.

Polls the ``ag_mcp_policies`` and ``ag_mcp_backends`` MongoDB collections,
renders ``config.yaml.j2`` with the current data, and writes the result
to a shared volume. AG's file watcher detects changes and hot-reloads.

On first start, seeds the collections from the static ``config.yaml``
defaults if they are empty.

Usage:
    python config-bridge.py  # uses env vars for configuration

Environment variables:
    MONGODB_URI          — MongoDB connection string  (required)
    MONGODB_DATABASE     — Database name              (required)
    AG_CONFIG_OUTPUT     — Output path for config.yaml (default: /etc/agentgateway/config.yaml)
    AG_TEMPLATE_PATH     — Path to config.yaml.j2      (default: /app/config.yaml.j2)
    AG_POLL_INTERVAL     — Poll interval in seconds     (default: 5)
    AG_ISSUER            — JWT issuer URL               (default: http://localhost:7080/realms/caipe)
    AG_AUDIENCE          — JWT audience                 (default: caipe-platform)
    AG_JWKS_URL          — JWKS endpoint URL            (default: http://keycloak:7080/realms/caipe/protocol/openid-connect/certs)
"""

import hashlib
import logging
import os
import signal
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from pymongo import MongoClient

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("ag-config-bridge")

MONGODB_URI = os.environ.get("MONGODB_URI", "")
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "")
AG_CONFIG_OUTPUT = os.environ.get("AG_CONFIG_OUTPUT", "/etc/agentgateway/config.yaml")
AG_TEMPLATE_PATH = os.environ.get("AG_TEMPLATE_PATH", "/app/config.yaml.j2")
AG_POLL_INTERVAL = int(os.environ.get("AG_POLL_INTERVAL", "5"))
AG_ISSUER = os.environ.get("AG_ISSUER", "http://localhost:7080/realms/caipe")
AG_AUDIENCE = os.environ.get("AG_AUDIENCE", "caipe-platform")
AG_JWKS_URL = os.environ.get(
    "AG_JWKS_URL",
    "http://keycloak:7080/realms/caipe/protocol/openid-connect/certs",
)

SEED_POLICIES = [
    {
        "backend_id": "rag",
        "tool_pattern": "admin_",
        "expression": '"admin" in jwt.realm_access.roles',
        "description": "Admin-only operations (FR-013, FR-014)",
        "enabled": True,
    },
    {
        "backend_id": "rag",
        "tool_pattern": "supervisor_config",
        "expression": '"admin" in jwt.realm_access.roles',
        "description": "Supervisor routing configuration",
        "enabled": True,
    },
    {
        "backend_id": "rag",
        "tool_pattern": "rag_query",
        "expression": (
            '("chat_user" in jwt.realm_access.roles || '
            '"team_member" in jwt.realm_access.roles || '
            '"kb_admin" in jwt.realm_access.roles || '
            '"admin" in jwt.realm_access.roles)'
        ),
        "description": "RAG query: chat_user, team_member, kb_admin, admin (FR-015)",
        "enabled": True,
    },
    {
        "backend_id": "rag",
        "tool_pattern": "rag_ingest",
        "expression": (
            '("kb_admin" in jwt.realm_access.roles || "admin" in jwt.realm_access.roles)'
        ),
        "description": "RAG ingest: kb_admin, admin only (FR-016)",
        "enabled": True,
    },
    {
        "backend_id": "rag",
        "tool_pattern": "rag_tool",
        "expression": (
            '("team_member" in jwt.realm_access.roles || '
            '"kb_admin" in jwt.realm_access.roles || '
            '"admin" in jwt.realm_access.roles)'
        ),
        "description": "RAG tool CRUD: team_member, kb_admin, admin",
        "enabled": True,
    },
    {
        "backend_id": "rag",
        "tool_pattern": "team_",
        "expression": (
            '("admin" in jwt.realm_access.roles || '
            '"kb_admin" in jwt.realm_access.roles || '
            '"team_member" in jwt.realm_access.roles)'
        ),
        "description": "Team-scoped tool invocation (FR-009)",
        "enabled": True,
    },
    {
        "backend_id": "rag",
        "tool_pattern": "dynamic_agent_",
        "expression": (
            '("admin" in jwt.realm_access.roles || '
            '"kb_admin" in jwt.realm_access.roles || '
            '"team_member" in jwt.realm_access.roles || '
            '"chat_user" in jwt.realm_access.roles)'
        ),
        "description": "Dynamic agent MCP (FR-030, US8)",
        "enabled": True,
    },
]

SEED_BACKENDS = [
    {
        "id": "rag",
        "upstream_url": "http://rag_server:9446/mcp",
        "description": "Knowledge Base (RAG Server)",
        "enabled": True,
    },
]

running = True


def handle_signal(_signum: int, _frame: object) -> None:
    global running
    log.info("Received shutdown signal, exiting...")
    running = False


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def seed_collections(db: object) -> None:
    """Seed policies and backends if the collections are empty."""
    policies_col = db["ag_mcp_policies"]
    if policies_col.count_documents({}) == 0:
        log.info("Seeding ag_mcp_policies with %d default rules", len(SEED_POLICIES))
        now = datetime.now(timezone.utc).isoformat()
        for p in SEED_POLICIES:
            policies_col.update_one(
                {"backend_id": p["backend_id"], "tool_pattern": p["tool_pattern"]},
                {
                    "$set": {
                        **p,
                        "updated_by": "config-bridge-seed",
                        "updated_at": now,
                    }
                },
                upsert=True,
            )

    backends_col = db["ag_mcp_backends"]
    if backends_col.count_documents({}) == 0:
        log.info("Seeding ag_mcp_backends with %d default targets", len(SEED_BACKENDS))
        now = datetime.now(timezone.utc).isoformat()
        for b in SEED_BACKENDS:
            backends_col.update_one(
                {"id": b["id"]},
                {
                    "$set": {
                        **b,
                        "updated_by": "config-bridge-seed",
                        "updated_at": now,
                    }
                },
                upsert=True,
            )


def render_config(
    jinja_env: Environment,
    policies: list[dict],
    backends: list[dict],
    generation: int,
) -> str:
    template = jinja_env.get_template(Path(AG_TEMPLATE_PATH).name)
    return template.render(
        issuer=AG_ISSUER,
        audience=AG_AUDIENCE,
        jwks_url=AG_JWKS_URL,
        policies=policies,
        backends=backends,
        generation=generation,
    )


def write_config_atomically(content: str, output_path: str) -> None:
    """Write config to a temp file then atomically rename into place."""
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(
        dir=str(output.parent), prefix=".ag-config-", suffix=".yaml"
    )
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp_path, output_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def main() -> None:
    if not MONGODB_URI or not MONGODB_DATABASE:
        log.error("MONGODB_URI and MONGODB_DATABASE must be set")
        sys.exit(1)

    if not Path(AG_TEMPLATE_PATH).exists():
        log.error("Template not found: %s", AG_TEMPLATE_PATH)
        sys.exit(1)

    client = MongoClient(MONGODB_URI)
    db = client[MONGODB_DATABASE]

    jinja_env = Environment(
        loader=FileSystemLoader(str(Path(AG_TEMPLATE_PATH).parent)),
        autoescape=False,
        keep_trailing_newline=True,
    )

    seed_collections(db)

    sync_col = db["ag_sync_state"]
    sync_col.update_one(
        {"_id": "current"},
        {"$setOnInsert": {"policy_generation": 0, "bridge_generation": 0}},
        upsert=True,
    )

    last_content_hash = ""
    log.info(
        "Config bridge started — polling every %ds, output: %s",
        AG_POLL_INTERVAL,
        AG_CONFIG_OUTPUT,
    )

    while running:
        try:
            policies = list(db["ag_mcp_policies"].find({}))
            backends = list(db["ag_mcp_backends"].find({}))
            state = sync_col.find_one({"_id": "current"}) or {}
            policy_gen = state.get("policy_generation", 0)

            content = render_config(jinja_env, policies, backends, policy_gen)
            content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]

            if content_hash != last_content_hash:
                write_config_atomically(content, AG_CONFIG_OUTPUT)
                last_content_hash = content_hash

                sync_col.update_one(
                    {"_id": "current"},
                    {
                        "$set": {
                            "bridge_generation": policy_gen,
                            "bridge_last_sync": datetime.now(timezone.utc).isoformat(),
                            "bridge_error": None,
                        }
                    },
                    upsert=True,
                )
                log.info(
                    "Config written (gen=%d, hash=%s)", policy_gen, content_hash
                )

        except Exception as exc:
            log.exception("Error during config sync: %s", exc)
            try:
                sync_col.update_one(
                    {"_id": "current"},
                    {
                        "$set": {
                            "bridge_error": str(exc),
                            "bridge_last_sync": datetime.now(timezone.utc).isoformat(),
                        }
                    },
                    upsert=True,
                )
            except Exception:
                pass

        time.sleep(AG_POLL_INTERVAL)

    client.close()
    log.info("Config bridge stopped")


if __name__ == "__main__":
    main()
