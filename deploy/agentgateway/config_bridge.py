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

import yaml


LOGGER = logging.getLogger("agentgateway-config-bridge")
SAFE_TARGET_ID = re.compile(r"^[A-Za-z0-9._-]+$")
PUBLISHED_CONFIG_MODE = 0o644

DEFAULT_MCP_ROUTE_POLICIES: dict[str, Any] = {
    "extAuthz": {
        "host": "openfga-authz-bridge:9100",
        "failureMode": {"denyWithStatus": 403},
        # Forward the HTTP request body to the bridge so it can parse the
        # JSON-RPC `tools/call` method+name and run the caller-keyed per-tool
        # check (FR-012/SC-010). Without this only gRPC metadata reaches the
        # bridge, `tool_call` is always None, and the caller-keyed block is
        # skipped — every MCP call would pass on the coarse `mcp_gateway:list`
        # check alone. Headers (x-caipe-agent-context*) are already delivered by
        # the gRPC protocol when includeRequestHeaders is empty; only the body
        # needs requesting. packAsBytes -> CheckRequest.http.raw_body, which the
        # bridge's _request_body_text() reads first. See issue #36. The per-route
        # overrides below only add `transformations` (shallow-merged), so they
        # inherit this extAuthz block unchanged.
        # Keep this in sync with deploy/agentgateway/config.yaml (bootstrap seed).
        "includeRequestBody": {
            "maxRequestBytes": 65536,
            "allowPartialMessage": False,
            "packAsBytes": True,
        },
        "protocol": {
            "grpc": {
                "metadata": {
                    # Carry preferred_username alongside sub so the bridge can
                    # detect service accounts (T002 rule) — the gateway's jwtAuth
                    # consumes the Authorization bearer and does NOT forward it in
                    # the ext_authz CheckRequest, so metadata is the only channel
                    # for the SA signal (#46/#49). Keep in sync with config.yaml.
                    "caipe.auth": '{"sub": jwt.sub, "preferred_username": jwt.preferred_username}',
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

# Target-level (per-backend) policies. GitHub/GitLab no longer use a static
# `backendAuth` PAT here; they authenticate per-request through the route-level
# transformation below (see DEFAULT_MCP_ROUTE_POLICY_OVERRIDES).
DEFAULT_MCP_TARGET_POLICIES: dict[str, dict[str, Any]] = {}

# Route-level policy overrides shallow-merged onto DEFAULT_MCP_ROUTE_POLICIES for
# specific servers. GitHub/GitLab upstreams expect `Authorization: Bearer <token>`.
# Dynamic Agents resolves the caller's own OAuth token (or, when the caller has
# not connected, the static org PAT via MCPCredentialSource.fallback_env) and
# forwards it on `X-CAIPE-Provider-Token`. This transformation rewrites that
# header into the upstream Authorization header, so connected users act as
# themselves while unconnected callers transparently fall back to the org token.
# Standalone config uses the `transformations` (plural) policy key with the
# `set` map form; CEL `default(...)` keeps the expression total when the header
# is absent. Keep in sync with deploy/agentgateway/config.yaml (bootstrap seed).
PROVIDER_TOKEN_BEARER_TRANSFORM: dict[str, Any] = {
    "transformations": {
        "request": {
            "set": {
                "authorization": (
                    '"Bearer " + default(request.headers["x-caipe-provider-token"], "")'
                ),
            },
        },
    },
}

# knowledge-base (RAG) reuses the same transform: the RAG server enforces its own
# Keycloak/OIDC auth on /mcp, so Dynamic Agents forwards the caller's user JWT (for
# per-user RAG group RBAC) or a caipe-platform service token (non-user contexts) on
# X-CAIPE-Provider-Token, which this rewrites into the upstream Authorization header.
DEFAULT_MCP_ROUTE_POLICY_OVERRIDES: dict[str, dict[str, Any]] = {
    "github": PROVIDER_TOKEN_BEARER_TRANSFORM,
    "gitlab": PROVIDER_TOKEN_BEARER_TRANSFORM,
    "knowledge-base": PROVIDER_TOKEN_BEARER_TRANSFORM,
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


def _is_managed_mcp_route_path(path: str | None) -> bool:
    """True for per-target ``/mcp/<id>`` routes this reconciler owns.

    Such routes are derived 1:1 from ``mcp_servers`` documents, so the reconciler
    is their single source of truth and may add *or* remove them. Non-MCP routes
    (anything not under ``/mcp/``) are never pruned.
    """
    return isinstance(path, str) and path.startswith("/mcp/")


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


def _route_policies_for(target_id: str, base: dict[str, Any]) -> dict[str, Any]:
    """Merge any per-server route-policy override onto the base MCP route policy."""

    merged = copy.deepcopy(base)
    override = DEFAULT_MCP_ROUTE_POLICY_OVERRIDES.get(target_id)
    if override:
        merged.update(copy.deepcopy(override))
    return merged


def load_builtin_mcp_routes(bootstrap_path: Path | None) -> dict[str, dict[str, Any]]:
    """Return ``{target_id: route}`` for every ``/mcp/<id>`` route shipped in the
    static bootstrap config (``deploy/agentgateway/config.yaml``).

    These are the platform's *built-in* MCP servers. Unlike runtime-added servers,
    they are never written to the ``mcp_servers`` Mongo collection, so the
    reconciler must treat them as a **protected baseline**: always rendered (from
    their authoritative bootstrap definition, including any per-route
    transformations) and never pruned just because they are absent from Mongo.

    Without this, an empty (or freshly reset) ``mcp_servers`` collection makes the
    reconciler classify all built-in ``/mcp/<id>`` routes as "stale managed
    routes" and wipe them — leaving AgentGateway with zero MCP routes.
    """

    if bootstrap_path is None or not bootstrap_path.exists():
        return {}
    try:
        config = yaml.safe_load(bootstrap_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        LOGGER.warning("Could not parse bootstrap config %s: %s", bootstrap_path, exc)
        return {}
    if not isinstance(config, dict):
        return {}

    builtins: dict[str, dict[str, Any]] = {}
    for bind in asarray_dicts(config.get("binds")):
        for listener in asarray_dicts(bind.get("listeners")):
            for route in asarray_dicts(listener.get("routes")):
                path = _route_path(route)
                if not _is_managed_mcp_route_path(path):
                    continue
                target_id = path[len("/mcp/") :]  # type: ignore[index]
                if SAFE_TARGET_ID.fullmatch(target_id):
                    builtins[target_id] = copy.deepcopy(route)
    return builtins


def asarray_dicts(value: Any) -> list[dict[str, Any]]:
    """Return ``value`` as a list of dicts (empty when not a list of dicts)."""

    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def merge_agentgateway_mcp_routes(
    baseline_config: dict[str, Any],
    targets: Iterable[McpGatewayTarget],
    *,
    route_policies: dict[str, Any] | None = None,
    builtin_routes: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return AgentGateway config with one route per desired MCP target.

    ``builtin_routes`` (id -> route) are statically shipped MCP servers that the
    reconciler protects: they are always re-rendered from their bootstrap
    definition and never pruned. Mongo-backed ``targets`` are layered on top as
    *dynamic* routes that may be added or pruned; a dynamic target sharing an id
    with a built-in defers to the built-in definition.
    """

    rendered = copy.deepcopy(baseline_config)
    listener = _first_http_listener(rendered)
    routes = listener.setdefault("routes", [])
    if not isinstance(routes, list):
        routes = []
        listener["routes"] = routes

    policies = route_policies or DEFAULT_MCP_ROUTE_POLICIES
    builtin_routes = builtin_routes or {}
    builtin_ids = set(builtin_routes)
    builtin_paths = {f"/mcp/{target_id}" for target_id in builtin_ids}
    # Dynamic (Mongo-managed) targets are everything not shipped as a built-in.
    dynamic_targets = [target for target in targets if target.id not in builtin_ids]
    desired_by_path = {f"/mcp/{target.id}": target for target in dynamic_targets}
    target_policies_by_path = {
        path: target_policies
        for route in routes
        if isinstance(route, dict)
        for path in [_route_path(route)]
        for target_policies in [_target_policies(route)]
        if path in desired_by_path and target_policies
    }
    # The reconciler owns every dynamic ``/mcp/<id>`` route, so drop *all* managed
    # MCP routes from the baseline and re-render the protected built-ins plus the
    # desired dynamic set below. This makes deletion automatic: when an
    # ``mcp_servers`` row is removed, its route is no longer in ``desired_by_path``
    # and simply isn't re-added. Built-in routes are exempt — they are restored
    # from ``builtin_routes`` regardless of Mongo state. Non-MCP routes (and any
    # malformed entries) are always retained.
    stale_paths = sorted(
        path
        for route in routes
        if isinstance(route, dict)
        for path in [_route_path(route)]
        if _is_managed_mcp_route_path(path)
        and path not in desired_by_path
        and path not in builtin_paths
    )
    if stale_paths:
        LOGGER.info("Pruning stale AgentGateway MCP routes: %s", stale_paths)
    retained_routes = [
        route
        for route in routes
        if not (isinstance(route, dict) and _is_managed_mcp_route_path(_route_path(route)))
    ]
    # Protected built-in routes: always present, rendered from their authoritative
    # bootstrap definition (preserving per-route transformations/policies).
    retained_routes.extend(copy.deepcopy(builtin_routes[target_id]) for target_id in sorted(builtin_ids))
    retained_routes.extend(
        _mcp_route(
            target,
            _route_policies_for(target.id, policies),
            # Servers handled by a route-level transformation must NOT carry a
            # target-level backendAuth (drop any stale PAT preserved from the
            # live config); their auth comes from the X-CAIPE-Provider-Token
            # transformation merged in by _route_policies_for above.
            target_policies=(
                None
                if target.id in DEFAULT_MCP_ROUTE_POLICY_OVERRIDES
                else (
                    target_policies_by_path.get(f"/mcp/{target.id}")
                    or DEFAULT_MCP_TARGET_POLICIES.get(target.id)
                )
            ),
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
    bootstrap_path: Path | None = None,
) -> dict[str, Any]:
    """Render and write one AgentGateway config generation."""

    targets = _load_targets_from_mongo()
    baseline = load_baseline_config(
        admin_config_url,
        allow_minimal_fallback=not config_path.exists(),
    )
    builtin_routes = load_builtin_mcp_routes(bootstrap_path)
    rendered = merge_agentgateway_mcp_routes(baseline, targets, builtin_routes=builtin_routes)
    changed = write_config_atomically(config_path, rendered)
    result = {
        "targets": [target.id for target in targets],
        "target_count": len(targets),
        "builtin_count": len(builtin_routes),
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
            reconcile_once(
                config_path=config_path,
                admin_config_url=admin_config_url,
                bootstrap_path=bootstrap_path,
            )
        except Exception:
            LOGGER.exception("AgentGateway MCP config reconciliation failed")
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
