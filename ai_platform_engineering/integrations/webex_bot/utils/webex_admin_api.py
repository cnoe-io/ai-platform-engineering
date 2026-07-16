"""Internal Webex bot admin API for route cache reload and config migration."""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import jwt
import requests
from jwt import PyJWKClient
from pymongo import MongoClient
from pymongo.collection import Collection

from ai_platform_engineering.integrations.slack_bot.utils.config_models import AgentBinding

from .webex_agent_routes import (
    DEFAULT_OPENFGA_HTTP,
    WebexAgentRouteResolver,
    get_webex_agent_route_resolver,
    webex_bot_installation_openfga_subject,
    webex_agent_route_mode,
    webex_space_openfga_subject,
    webex_workspace_ref,
)
from .webex_bot_catalog import configured_webex_bots
from .webex_config_models import WebexBotConfig
from .webex_ids import canonicalize_webex_space_id

logger = logging.getLogger("caipe.webex_bot.webex_admin_api")

MAX_ADMIN_REQUEST_BODY_BYTES = 64 * 1024
ROUTE_METADATA_FIELDS = ("users", "bots", "escalation")

CollectionFactory = Callable[[str], Optional[Collection[Any]]]
OpenFgaWriter = Callable[[dict[str, str]], None]


class OpenFgaWriteError(RuntimeError):
    """Raised when a config-sync OpenFGA tuple write fails."""

    def __init__(self, message: str, *, route: dict[str, Any], summary: dict[str, Any]) -> None:
        super().__init__(message)
        self.route = route
        self.summary = summary


def webex_admin_jwt_audience() -> str:
    """JWT audience for Webex bot admin API (``WEBEX_ADMIN_JWT_AUDIENCE`` preferred).

    ``WEBEX_ADMIN_API_AUDIENCE`` is accepted as a deployment alias for the same value.
    """

    explicit = os.environ.get("WEBEX_ADMIN_JWT_AUDIENCE", "").strip()
    if explicit:
        return explicit
    alias = os.environ.get("WEBEX_ADMIN_API_AUDIENCE", "").strip()
    if alias:
        return alias
    return "caipe-webex-bot-admin"


def _thread_context_status() -> dict[str, int | bool]:
    enabled_raw = os.environ.get("WEBEX_THREAD_CONTEXT_ENABLED", "true").strip().lower()
    try:
        max_messages = max(1, int(os.environ.get("WEBEX_THREAD_CONTEXT_MAX_MESSAGES", "10")))
    except ValueError:
        max_messages = 10
    try:
        max_chars = max(200, int(os.environ.get("WEBEX_THREAD_CONTEXT_MAX_CHARS", "4000")))
    except ValueError:
        max_chars = 4000
    return {
        "enabled": enabled_raw not in {"false", "0", "no", "off"},
        "max_messages": max_messages,
        "max_chars": max_chars,
    }


@dataclass(frozen=True)
class WebexAdminAuthResult:
    """Verified Webex admin API caller identity."""

    client_id: str
    subject: str | None
    scopes: list[str]
    claims: dict[str, Any]


class WebexAdminAuthError(PermissionError):
    """Raised when a Webex admin API request is not authorized."""


class WebexAdminTokenValidator:
    """Validate Webex admin API service tokens with Keycloak JWKS."""

    def __init__(
        self,
        *,
        issuer: str | None = None,
        audience: str | None = None,
        jwks_url: str | None = None,
        allowed_client_ids: list[str] | None = None,
    ) -> None:
        self.issuer = issuer or os.environ.get("WEBEX_ADMIN_JWT_ISSUER") or os.environ.get("OIDC_ISSUER")
        self.audience = audience or webex_admin_jwt_audience()
        self.jwks_url = jwks_url or os.environ.get("WEBEX_ADMIN_JWKS_URL") or self._discover_jwks_url()
        raw_clients = os.environ.get("WEBEX_ADMIN_ALLOWED_CLIENT_IDS", "caipe-ui")
        self.allowed_client_ids = allowed_client_ids or [
            value.strip() for value in raw_clients.split(",") if value.strip()
        ]
        self._jwks_client = PyJWKClient(self.jwks_url) if self.jwks_url else None

    def _discover_jwks_url(self) -> str | None:
        issuer = self.issuer
        if not issuer:
            return None
        discovery_base = os.environ.get("OIDC_DISCOVERY_URL") or issuer
        discovery_url = discovery_base.rstrip("/")
        if not discovery_url.endswith("/.well-known/openid-configuration"):
            discovery_url = f"{discovery_url}/.well-known/openid-configuration"
        response = requests.get(discovery_url, timeout=5)
        response.raise_for_status()
        jwks_url = response.json().get("jwks_uri")
        return str(jwks_url) if jwks_url else None

    def validate(self, token: str, *, required_scope: str | None = None) -> WebexAdminAuthResult:
        if not self.issuer or not self.audience or not self._jwks_client:
            raise WebexAdminAuthError("Webex admin JWT validation is not configured")
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "RS384", "RS512", "ES256"],
                audience=self.audience,
                issuer=self.issuer,
            )
        except Exception as exc:  # noqa: BLE001
            raise WebexAdminAuthError("Invalid Webex admin bearer token") from exc

        client_id = str(claims.get("azp") or claims.get("client_id") or "").strip()
        if self.allowed_client_ids and client_id not in self.allowed_client_ids:
            raise WebexAdminAuthError("Webex admin bearer token client is not allowed")

        scopes = str(claims.get("scope") or "").split()
        if required_scope and required_scope not in scopes:
            raise WebexAdminAuthError(f"Webex admin bearer token is missing scope {required_scope}")

        return WebexAdminAuthResult(
            client_id=client_id,
            subject=str(claims.get("sub")) if claims.get("sub") else None,
            scopes=scopes,
            claims=claims,
        )


class WebexBotAdminService:
    """Operations exposed through the internal Webex bot admin API."""

    def __init__(
        self,
        *,
        config: WebexBotConfig,
        resolver: WebexAgentRouteResolver,
        collection_factory: CollectionFactory | None = None,
        openfga_writer: OpenFgaWriter | None = None,
    ) -> None:
        self._config = config
        self._resolver = resolver
        self._collection_factory = collection_factory
        self._openfga_writer = openfga_writer
        self._client: Optional[MongoClient] = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")
        self._last_sync: dict[str, Any] | None = None

    def _get_client(self) -> Optional[MongoClient]:
        uri = os.environ.get("MONGODB_URI", "").strip()
        if not uri:
            return None
        if self._client is None:
            self._client = MongoClient(uri, serverSelectionTimeoutMS=5000, retryWrites=False)
        return self._client

    def _collection(self, name: str) -> Optional[Collection[Any]]:
        if self._collection_factory is not None:
            return self._collection_factory(name)
        client = self._get_client()
        if client is None:
            return None
        return client[self._db_name][name]

    def status(self) -> dict[str, Any]:
        route_count = sum(len(space.agents) for space in self._config.spaces.values())
        return {
            "route_mode": webex_agent_route_mode(),
            "static_config": {
                "spaces": len(self._config.spaces),
                "routes": route_count,
            },
            "thread_context": _thread_context_status(),
            "route_cache": self._resolver.cache_status(),
            "last_sync": self._last_sync,
        }

    def reload_routes(
        self,
        *,
        bot_id: str | None = None,
        workspace_id: str | None = None,
        space_id: str | None = None,
    ) -> dict[str, str]:
        if bot_id and workspace_id and space_id:
            self._resolver.invalidate(bot_id, workspace_id, space_id)
            return {
                "reloaded": "space",
                "bot_id": bot_id,
                "workspace_id": workspace_id,
                "space_id": space_id,
            }
        self._resolver.invalidate_all()
        return {"reloaded": "all"}

    def sync_from_config(
        self,
        *,
        bot_id: str,
        workspace_id: str | None = None,
        dry_run: bool = True,
        actor: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        workspace_ref = webex_workspace_ref(workspace_id)
        if bot_id not in {bot.id for bot in configured_webex_bots()}:
            raise ValueError(f"Unknown Webex bot: {bot_id}")
        routes = self._collection("webex_space_agent_routes")
        if routes is None and not dry_run:
            raise RuntimeError("MongoDB is not configured for Webex route sync")

        now = datetime.now(timezone.utc).isoformat()
        planned = self._planned_routes(bot_id, workspace_ref)
        summary: dict[str, Any] = {
            "dry_run": dry_run,
            "bot_id": bot_id,
            "workspace_id": workspace_ref,
            "spaces_seen": len(self._config.spaces),
            "routes_planned": len(planned),
            "routes_upserted": 0,
            "openfga_tuples_written": 0,
            "updated_at": now,
            "actor": actor or {},
        }

        if dry_run:
            self._last_sync = summary
            return summary

        assert routes is not None
        for route in planned:
            try:
                routes.update_one(
                    {
                        "bot_id": route["bot_id"],
                        "workspace_id": route["workspace_id"],
                        "space_id": route["space_id"],
                        "agent_id": route["agent_id"],
                    },
                    _route_upsert_update(route, now),
                    upsert=True,
                )
                summary["routes_upserted"] += 1
                self._resolver.invalidate(
                    str(route["bot_id"]),
                    str(route["workspace_id"]),
                    str(route["space_id"]),
                )
                installation = webex_bot_installation_openfga_subject(
                    str(route["bot_id"]),
                    str(route["workspace_id"]),
                    str(route["space_id"]),
                )
                for tuple_key in (
                    {
                        "user": f"webex_bot:{route['bot_id']}",
                        "relation": "bot",
                        "object": installation,
                    },
                    {
                        "user": webex_space_openfga_subject(
                            str(route["workspace_id"]), str(route["space_id"])
                        ),
                        "relation": "space",
                        "object": installation,
                    },
                    {
                        "user": installation,
                        "relation": "user",
                        "object": f"agent:{route['agent_id']}",
                    },
                ):
                    self._write_openfga_tuple(tuple_key)
                    summary["openfga_tuples_written"] += 1
            except Exception as exc:  # noqa: BLE001
                summary["openfga_write_failed"] = True
                summary["error"] = str(exc)
                summary["failed_route"] = {
                    "bot_id": route.get("bot_id"),
                    "workspace_id": route.get("workspace_id"),
                    "space_id": route.get("space_id"),
                    "agent_id": route.get("agent_id"),
                }
                self._last_sync = summary
                raise OpenFgaWriteError(str(exc), route=route, summary=summary) from exc

        self._last_sync = summary
        return summary

    def _planned_routes(self, bot_id: str, workspace_ref: str) -> list[dict[str, Any]]:
        planned: list[dict[str, Any]] = []
        for space_id, space in self._config.spaces.items():
            canonical_space_id = canonicalize_webex_space_id(space_id)
            for index, agent in enumerate(space.agents):
                planned.append(
                    _route_from_agent_binding(
                        bot_id, workspace_ref, canonical_space_id, agent, index
                    )
                )
        return planned

    def _write_openfga_tuple(self, tuple_key: dict[str, str]) -> None:
        if self._openfga_writer is not None:
            self._openfga_writer(tuple_key)
            return

        base_url = (os.environ.get("OPENFGA_HTTP", "").strip() or DEFAULT_OPENFGA_HTTP).rstrip("/")
        store_id = _openfga_store_id(base_url)
        response = requests.post(
            f"{base_url}/stores/{store_id}/write",
            headers={"Content-Type": "application/json"},
            json={"writes": {"tuple_keys": [tuple_key]}},
            timeout=5,
        )
        if response.status_code >= 400 and "already" not in response.text.lower():
            response.raise_for_status()


def _route_from_agent_binding(
    bot_id: str,
    workspace_ref: str,
    space_id: str,
    agent: AgentBinding,
    index: int,
) -> dict[str, Any]:
    route: dict[str, Any] = {
        "bot_id": bot_id,
        "workspace_id": workspace_ref,
        "space_id": space_id,
        "agent_id": agent.agent_id,
        "enabled": True,
        "priority": (index + 1) * 100,
    }
    if agent.users is not None:
        route["users"] = agent.users.model_dump(exclude_none=True)
    if agent.bots is not None:
        route["bots"] = agent.bots.model_dump(exclude_none=True)
    if agent.escalation is not None:
        route["escalation"] = agent.escalation.model_dump(exclude_none=True)
    return route


def _route_upsert_update(route: dict[str, Any], now: str) -> dict[str, Any]:
    unset = {field: "" for field in ROUTE_METADATA_FIELDS if field not in route}
    update: dict[str, Any] = {
        "$set": {
            **route,
            "source_type": "config_sync",
            "status": "active",
            "updated_by": "webex_admin_sync",
            "updated_at": now,
        },
        "$setOnInsert": {
            "created_by": "webex_admin_sync",
            "created_at": now,
        },
    }
    if unset:
        update["$unset"] = unset
    return update


def _openfga_store_id(base_url: str) -> str:
    explicit = os.environ.get("OPENFGA_STORE_ID", "").strip()
    if explicit:
        return explicit

    store_name = os.environ.get("OPENFGA_STORE_NAME", "caipe-openfga").strip()
    response = requests.get(f"{base_url}/stores", headers={"Content-Type": "application/json"}, timeout=5)
    response.raise_for_status()
    for store in response.json().get("stores", []):
        if store.get("name") == store_name and store.get("id"):
            return str(store["id"])
    raise requests.RequestException(f"OpenFGA store {store_name!r} was not found")


class _WebexAdminRequestHandler(BaseHTTPRequestHandler):
    service: WebexBotAdminService
    validator: WebexAdminTokenValidator

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/admin/webex/routes/status":
            self._write_json({"error": "not_found"}, status=404)
            return
        if not self._authorize(scope_env="WEBEX_ADMIN_STATUS_SCOPE"):
            return
        self._write_json(self.service.status())

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        body = self._read_json()
        if body is None:
            return
        if path == "/admin/webex/routes/reload":
            if not self._authorize(scope_env="WEBEX_ADMIN_RELOAD_SCOPE"):
                return
            self._write_json(
                self.service.reload_routes(
                    bot_id=_optional_string(body.get("bot_id")),
                    workspace_id=_optional_string(body.get("workspace_id")),
                    space_id=_optional_string(body.get("space_id")),
                )
            )
            return
        if path == "/admin/webex/routes/sync-from-config":
            if not self._authorize(scope_env="WEBEX_ADMIN_SYNC_SCOPE"):
                return
            try:
                summary = self.service.sync_from_config(
                    bot_id=_required_string(body.get("bot_id"), "bot_id"),
                    workspace_id=_optional_string(body.get("workspace_id")),
                    dry_run=body.get("dry_run") is not False,
                    actor=body.get("actor") if isinstance(body.get("actor"), dict) else {},
                )
                self._write_json(summary)
            except OpenFgaWriteError as exc:
                logger.warning("Webex admin config sync partial failure: %s", exc)
                self._write_json(exc.summary, status=500)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Webex admin config sync failed: %s", exc)
                self._write_json({"error": str(exc)}, status=500)
            return
        self._write_json({"error": "not_found"}, status=404)

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _authorize(self, *, scope_env: str) -> bool:
        header = self.headers.get("Authorization", "")
        token = header.removeprefix("Bearer ").strip()
        if not token:
            self._write_json({"error": "missing_bearer"}, status=401)
            return False
        try:
            required_scope = os.environ.get(scope_env, "").strip() or None
            self.validator.validate(token, required_scope=required_scope)
            return True
        except WebexAdminAuthError as exc:
            self._write_json({"error": str(exc)}, status=403)
            return False

    def _read_json(self) -> dict[str, Any] | None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        if length > MAX_ADMIN_REQUEST_BODY_BYTES:
            self._write_json({"error": "request_body_too_large"}, status=413)
            return None
        raw = self.rfile.read(length).decode("utf-8")
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _write_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def _optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _required_string(value: object, field: str) -> str:
    normalized = _optional_string(value)
    if normalized is None:
        raise ValueError(f"{field} is required")
    return normalized


def load_webex_bot_config() -> WebexBotConfig:
    """Load optional static Webex routing config (empty when unset)."""

    return WebexBotConfig.from_env()


def start_webex_admin_api_server(
    config: WebexBotConfig | None = None,
) -> ThreadingHTTPServer | None:
    """Start the internal admin API in a background thread when enabled."""

    if os.environ.get("WEBEX_ADMIN_API_ENABLED", "false").lower() != "true":
        return None
    host = os.environ.get("WEBEX_ADMIN_API_HOST", "0.0.0.0")
    port = int(os.environ.get("WEBEX_ADMIN_API_PORT", "3002"))
    service = WebexBotAdminService(
        config=config or load_webex_bot_config(),
        resolver=get_webex_agent_route_resolver(),
    )
    validator = WebexAdminTokenValidator()

    class Handler(_WebexAdminRequestHandler):
        pass

    Handler.service = service
    Handler.validator = validator
    server = ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="webex-admin-api")
    thread.start()
    logger.info("Started Webex bot admin API on %s:%s", host, port)
    return server
