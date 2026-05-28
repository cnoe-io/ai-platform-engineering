# assisted-by Codex Codex-sonnet-4-6

"""Reconcile Mongo MCP server records into standalone AgentGateway config.

AgentGateway's Kubernetes mode should use native Gateway API resources
(`HTTPRoute` + `AgentgatewayBackend`). Local Docker Compose runs standalone
AgentGateway from a config file, and AgentGateway hot-reloads route/backend
changes written to that file. This bridge keeps those local routes in sync
with the `mcp_servers` collection so runtime-added MCP servers get a matching
`/mcp/<server_id>` route.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import re
import stat
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


LOGGER = logging.getLogger("agentgateway-config-bridge")
SAFE_TARGET_ID = re.compile(r"^[A-Za-z0-9._-]+$")
PUBLISHED_CONFIG_MODE = 0o644

DEFAULT_MCP_ROUTE_POLICIES: dict[str, Any] = {
    "extAuthz": {
        "host": "openfga-authz-bridge:9100",
        "failureMode": {"denyWithStatus": 403},
        "protocol": {
            "grpc": {
                "metadata": {
                    "caipe.auth": '{"sub": jwt.sub}',
                },
            },
        },
    },
    "authorization": {
        "rules": [
            {"allow": "true"},
        ],
    },
}

DEFAULT_MCP_TARGET_POLICIES: dict[str, dict[str, Any]] = {
    "github": {
        "backendAuth": {
            "key": "$GITHUB_PERSONAL_ACCESS_TOKEN",
        },
    },
    "gitlab": {
        "backendAuth": {
            "key": "$GITLAB_PERSONAL_ACCESS_TOKEN",
        },
    },
}


@dataclass(frozen=True)
class McpGatewayTarget:
    """AgentGateway MCP target rendered from an `mcp_servers` document."""

    id: str
    upstream_url: str


def _as_bool(value: Any, *, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off"}
    return bool(value)


def _server_id(document: dict[str, Any]) -> str | None:
    raw_id = document.get("_id") or document.get("id")
    if not isinstance(raw_id, str):
        return None
    target_id = raw_id.strip()
    return target_id if SAFE_TARGET_ID.fullmatch(target_id) else None


def _upstream_url(document: dict[str, Any]) -> str | None:
    raw_url = document.get("agentgateway_target_endpoint") or document.get(
        "agentgateway_upstream_url"
    )
    if not isinstance(raw_url, str):
        return None
    upstream_url = raw_url.strip()
    if not upstream_url.startswith(("http://", "https://")):
        return None
    return upstream_url


def select_gateway_targets(documents: Iterable[dict[str, Any]]) -> list[McpGatewayTarget]:
    """Select enabled AgentGateway-managed MCP targets from Mongo documents."""

    targets: list[McpGatewayTarget] = []
    seen: set[str] = set()
    for document in documents:
        if not _as_bool(document.get("enabled"), default=True):
            continue
        if document.get("source") != "agentgateway" and not document.get(
            "agentgateway_discovered"
        ):
            continue
        target_id = _server_id(document)
        upstream_url = _upstream_url(document)
        if target_id is None or upstream_url is None:
            continue
        if target_id in seen:
            continue
        targets.append(McpGatewayTarget(id=target_id, upstream_url=upstream_url))
        seen.add(target_id)
    return targets


def _first_http_listener(config: dict[str, Any]) -> dict[str, Any]:
    binds = config.setdefault("binds", [{"port": 4000, "listeners": [{}]}])
    if not isinstance(binds, list) or not binds:
        config["binds"] = [{"port": 4000, "listeners": [{}]}]
        binds = config["binds"]
    bind = binds[0]
    if not isinstance(bind, dict):
        bind = {"port": 4000, "listeners": [{}]}
        binds[0] = bind
    listeners = bind.setdefault("listeners", [{}])
    if not isinstance(listeners, list) or not listeners:
        bind["listeners"] = [{}]
        listeners = bind["listeners"]
    listener = listeners[0]
    if not isinstance(listener, dict):
        listener = {}
        listeners[0] = listener
    listener.setdefault("protocol", "HTTP")
    listener.setdefault("routes", [])
    return listener


def _route_path(route: dict[str, Any]) -> str | None:
    matches = route.get("matches")
    if not isinstance(matches, list):
        return None
    for match in matches:
        if not isinstance(match, dict):
            continue
        path = match.get("path")
        if not isinstance(path, dict):
            continue
        value = path.get("pathPrefix") or path.get("value")
        if isinstance(value, str):
            return value
    return None


def _target_policies(route: dict[str, Any]) -> dict[str, Any] | None:
    backends = route.get("backends")
    if not isinstance(backends, list) or not backends:
        return None
    backend = backends[0]
    if not isinstance(backend, dict):
        return None
    mcp_backend = backend.get("mcp")
    if not isinstance(mcp_backend, dict):
        return None
    targets = mcp_backend.get("targets")
    if not isinstance(targets, list) or not targets:
        return None
    target = targets[0]
    if not isinstance(target, dict):
        return None
    policies = target.get("policies")
    return copy.deepcopy(policies) if isinstance(policies, dict) else None


def _mcp_route(
    target: McpGatewayTarget,
    policies: dict[str, Any],
    *,
    target_policies: dict[str, Any] | None = None,
) -> dict[str, Any]:
    mcp_target = {
        "name": target.id,
        "mcp": {"host": target.upstream_url},
    }
    if target_policies:
        mcp_target["policies"] = copy.deepcopy(target_policies)
    return {
        "matches": [{"path": {"pathPrefix": f"/mcp/{target.id}"}}],
        "policies": copy.deepcopy(policies),
        "backends": [
            {
                "mcp": {
                    "targets": [mcp_target],
                },
            },
        ],
    }


def merge_agentgateway_mcp_routes(
    baseline_config: dict[str, Any],
    targets: Iterable[McpGatewayTarget],
    *,
    route_policies: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return AgentGateway config with one route per desired MCP target."""

    rendered = copy.deepcopy(baseline_config)
    listener = _first_http_listener(rendered)
    routes = listener.setdefault("routes", [])
    if not isinstance(routes, list):
        routes = []
        listener["routes"] = routes

    policies = route_policies or DEFAULT_MCP_ROUTE_POLICIES
    desired_by_path = {f"/mcp/{target.id}": target for target in targets}
    target_policies_by_path = {
        path: target_policies
        for route in routes
        if isinstance(route, dict)
        for path in [_route_path(route)]
        for target_policies in [_target_policies(route)]
        if path in desired_by_path and target_policies
    }
    retained_routes = [
        route
        for route in routes
        if not (isinstance(route, dict) and _route_path(route) in desired_by_path)
    ]
    retained_routes.extend(
        _mcp_route(
            target,
            policies,
            target_policies=target_policies_by_path.get(f"/mcp/{target.id}")
            or DEFAULT_MCP_TARGET_POLICIES.get(target.id),
        )
        for target in sorted(desired_by_path.values(), key=lambda t: t.id)
    )
    listener["routes"] = retained_routes
    return rendered


def fetch_agentgateway_config(admin_config_url: str) -> dict[str, Any]:
    """Fetch the current live AgentGateway config from the admin endpoint."""

    with urllib.request.urlopen(admin_config_url, timeout=5) as response:
        payload = response.read().decode("utf-8")
    config = json.loads(payload)
    if not isinstance(config, dict):
        raise ValueError("AgentGateway admin config response was not an object")
    return config


def _ensure_published_config_mode(path: Path) -> bool:
    """Ensure AgentGateway's non-root UID can read the generated config."""

    current_mode = stat.S_IMODE(path.stat().st_mode)
    if current_mode == PUBLISHED_CONFIG_MODE:
        return False
    path.chmod(PUBLISHED_CONFIG_MODE)
    return True


def write_config_atomically(path: Path, config: dict[str, Any]) -> bool:
    """Write config as JSON/YAML-compatible content; return true when changed."""

    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(config, indent=2, sort_keys=False) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        _ensure_published_config_mode(path)
        return False

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as handle:
        handle.write(rendered)
        tmp_path = Path(handle.name)
    tmp_path.chmod(PUBLISHED_CONFIG_MODE)
    tmp_path.replace(path)
    return True


def seed_config_from_bootstrap(config_path: Path, bootstrap_path: Path | None) -> bool:
    """Copy the static bootstrap config before AgentGateway is available."""

    if config_path.exists() or bootstrap_path is None or not bootstrap_path.exists():
        return False
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=config_path.parent,
        delete=False,
    ) as handle:
        handle.write(bootstrap_path.read_text(encoding="utf-8"))
        tmp_path = Path(handle.name)
    tmp_path.chmod(PUBLISHED_CONFIG_MODE)
    tmp_path.replace(config_path)
    LOGGER.info("Seeded AgentGateway config from %s", bootstrap_path)
    return True


def _minimal_config() -> dict[str, Any]:
    issuer = os.getenv("AGENTGATEWAY_JWT_ISSUER", "http://localhost:7080/realms/caipe")
    jwks_url = os.getenv(
        "AGENTGATEWAY_JWKS_URL",
        "http://keycloak:7080/realms/caipe/protocol/openid-connect/certs",
    )
    audiences = [
        audience.strip()
        for audience in os.getenv(
            "AGENTGATEWAY_JWT_AUDIENCES",
            "caipe-platform,agentgateway",
        ).split(",")
        if audience.strip()
    ]
    return {
        "binds": [
            {
                "port": int(os.getenv("AGENTGATEWAY_PORT", "4000")),
                "listeners": [
                    {
                        "protocol": "HTTP",
                        "policies": {
                            "jwtAuth": {
                                "mode": "strict",
                                "issuer": issuer,
                                "audiences": audiences,
                                "jwks": {"url": jwks_url},
                            },
                        },
                        "routes": [],
                    },
                ],
            },
        ],
        "config": {
            "adminAddr": os.getenv("AGENTGATEWAY_ADMIN_ADDR", "0.0.0.0:15000"),
            "logging": {"level": os.getenv("LOG_LEVEL", "info"), "format": "json"},
        },
    }


def load_baseline_config(
    admin_config_url: str,
    *,
    allow_minimal_fallback: bool = True,
) -> dict[str, Any]:
    """Load live config, falling back to a minimal bootstrap config."""

    try:
        return fetch_agentgateway_config(admin_config_url)
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
        if not allow_minimal_fallback:
            raise
        LOGGER.warning("Falling back to minimal AgentGateway config: %s", exc)
        return _minimal_config()


def _load_targets_from_mongo() -> list[McpGatewayTarget]:
    from pymongo import MongoClient

    mongo_uri = os.environ["MONGODB_URI"]
    database_name = os.getenv("MONGODB_DATABASE", "caipe")
    collection_name = os.getenv("MCP_SERVERS_COLLECTION", "mcp_servers")
    with MongoClient(mongo_uri) as client:
        documents = list(client[database_name][collection_name].find({}))
    return select_gateway_targets(documents)


def reconcile_once(
    *,
    config_path: Path,
    admin_config_url: str,
) -> dict[str, Any]:
    """Render and write one AgentGateway config generation."""

    targets = _load_targets_from_mongo()
    baseline = load_baseline_config(
        admin_config_url,
        allow_minimal_fallback=not config_path.exists(),
    )
    rendered = merge_agentgateway_mcp_routes(baseline, targets)
    changed = write_config_atomically(config_path, rendered)
    result = {
        "targets": [target.id for target in targets],
        "target_count": len(targets),
        "changed": changed,
        "config_path": str(config_path),
    }
    if changed:
        LOGGER.info("AgentGateway MCP config reconciled: %s", result)
    else:
        LOGGER.debug("AgentGateway MCP config unchanged: %s", result)
    return result


def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if not os.getenv("MONGODB_URI"):
        raise RuntimeError("MONGODB_URI is required")

    config_path = Path(os.getenv("AGENTGATEWAY_CONFIG_PATH", "/generated/config.yaml"))
    bootstrap_config_path = os.getenv("AGENTGATEWAY_BOOTSTRAP_CONFIG_PATH")
    bootstrap_path = Path(bootstrap_config_path) if bootstrap_config_path else None
    admin_config_url = os.getenv(
        "AGENTGATEWAY_ADMIN_CONFIG_URL",
        "http://agentgateway:15000/config",
    )
    poll_seconds = float(os.getenv("AGENTGATEWAY_CONFIG_BRIDGE_POLL_SECONDS", "5"))
    seed_config_from_bootstrap(config_path, bootstrap_path)

    while True:
        try:
            reconcile_once(config_path=config_path, admin_config_url=admin_config_url)
        except Exception:
            LOGGER.exception("AgentGateway MCP config reconciliation failed")
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
