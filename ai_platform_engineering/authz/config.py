"""Environment configuration for the standalone authorization service."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

from ai_platform_engineering.authz.migration.config import MigrationRoutingRevision


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    http_bind: str = "0.0.0.0"
    http_port: int = 8090
    grpc_bind: str = "0.0.0.0:9191"
    openfga_url: str = "http://openfga:8080"
    openfga_store_name: str = "caipe-openfga"
    openfga_store_id: str = ""
    openfga_model_id: str = ""
    openfga_model_sha256: str = ""
    provider_timeout_seconds: float = 2.0
    decision_concurrency: int = 128
    inspection_concurrency: int = 8
    batch_limit: int = 200
    service_token: str = ""
    admin_token: str = ""
    allow_insecure_headers: bool = False
    jwt_jwks_url: str = ""
    jwt_issuer: str = ""
    jwt_audiences: tuple[str, ...] = ()
    audit_service_url: str = "http://audit-service:8010"
    audit_outbox_path: str = "/var/lib/caipe-authz/audit-outbox.db"
    audit_outbox_capacity: int = 10000
    audit_strict_allows: bool = True
    audit_subject_salt: str = "caipe-authz"
    mongo_url: str = "mongodb://caipe-mongodb:27017"
    mongo_database: str = "caipe"
    rollout_json: str = ""
    schema_hashes_json: str = "{}"
    agent_context_hmac_secret: str = ""
    restricted_mcp_servers: tuple[str, ...] = ()
    tool_policy_max_body_bytes: int = 65536

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            http_bind=os.environ.get("AUTHZ_HTTP_BIND", "0.0.0.0"),
            http_port=int(os.environ.get("AUTHZ_HTTP_PORT", "8090")),
            grpc_bind=os.environ.get("AUTHZ_GRPC_BIND", "0.0.0.0:9191"),
            openfga_url=os.environ.get("OPENFGA_HTTP", "http://openfga:8080"),
            openfga_store_name=os.environ.get("OPENFGA_STORE_NAME", "caipe-openfga"),
            openfga_store_id=os.environ.get("OPENFGA_STORE_ID", ""),
            openfga_model_id=os.environ.get("OPENFGA_AUTHORIZATION_MODEL_ID", ""),
            openfga_model_sha256=os.environ.get("OPENFGA_MODEL_SHA256", ""),
            provider_timeout_seconds=float(os.environ.get("AUTHZ_PROVIDER_TIMEOUT_SECONDS", "2")),
            decision_concurrency=int(os.environ.get("AUTHZ_DECISION_CONCURRENCY", "128")),
            inspection_concurrency=int(os.environ.get("AUTHZ_INSPECTION_CONCURRENCY", "8")),
            batch_limit=int(os.environ.get("AUTHZ_BATCH_LIMIT", "200")),
            service_token=os.environ.get("AUTHZ_SERVICE_TOKEN", ""),
            admin_token=os.environ.get("AUTHZ_ADMIN_TOKEN", ""),
            allow_insecure_headers=_bool("AUTHZ_ALLOW_INSECURE_HEADERS", False),
            jwt_jwks_url=os.environ.get("JWT_JWKS_URL", ""),
            jwt_issuer=os.environ.get("JWT_ISSUER", ""),
            jwt_audiences=tuple(
                value.strip()
                for value in os.environ.get("JWT_AUDIENCES", "").split(",")
                if value.strip()
            ),
            audit_service_url=os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8010"),
            audit_outbox_path=os.environ.get(
                "AUTHZ_AUDIT_OUTBOX_PATH",
                "/var/lib/caipe-authz/audit-outbox.db",
            ),
            audit_outbox_capacity=int(os.environ.get("AUTHZ_AUDIT_OUTBOX_CAPACITY", "10000")),
            audit_strict_allows=_bool("AUTHZ_AUDIT_STRICT_ALLOWS", True),
            audit_subject_salt=os.environ.get("AUDIT_SUBJECT_SALT", "caipe-authz"),
            mongo_url=os.environ.get("MONGODB_URI", "mongodb://caipe-mongodb:27017"),
            mongo_database=os.environ.get("AUTHZ_MONGODB_DATABASE", "caipe"),
            rollout_json=os.environ.get("AUTHZ_ROLLOUT_JSON", ""),
            schema_hashes_json=os.environ.get("CAIPE_TOOL_SCHEMA_HASHES_JSON", "{}"),
            agent_context_hmac_secret=os.environ.get("CAIPE_AGENT_CONTEXT_HMAC_SECRET", ""),
            restricted_mcp_servers=tuple(
                value.strip()
                for value in os.environ.get("CAIPE_RESTRICTED_MCP_SERVERS", "").split(",")
                if value.strip()
            ),
            tool_policy_max_body_bytes=int(
                os.environ.get("CAIPE_TOOL_POLICY_MAX_BODY_BYTES", "65536")
            ),
        )

    def rollout(self) -> MigrationRoutingRevision:
        if self.rollout_json:
            return MigrationRoutingRevision.model_validate_json(self.rollout_json)
        return MigrationRoutingRevision(
            revision="legacy-default",
            default_mode="LEGACY",
            canary_seed="default-disabled-canary-seed",
        )

    def schema_hashes(self) -> dict[str, str]:
        value = json.loads(self.schema_hashes_json or "{}")
        if not isinstance(value, dict) or not all(
            isinstance(key, str) and isinstance(item, str) for key, item in value.items()
        ):
            raise ValueError("CAIPE_TOOL_SCHEMA_HASHES_JSON must be a string map")
        return value

    def validate(self) -> None:
        if self.http_port <= 0 or self.batch_limit <= 0 or self.tool_policy_max_body_bytes <= 0:
            raise ValueError("authorization service limits must be positive")
        rollout = self.rollout()
        schema_hashes = self.schema_hashes()
        expression_resources = {
            resource
            for scope in rollout.scopes
            if scope.expression_mode != "off"
            for resource in scope.exact_resources
        }
        if expression_resources and not self.openfga_model_id:
            raise ValueError("OPENFGA_AUTHORIZATION_MODEL_ID is required for expression rollout")
        if expression_resources and not self.openfga_model_sha256:
            raise ValueError("OPENFGA_MODEL_SHA256 is required for expression rollout")
        if self.openfga_model_sha256 and not re.fullmatch(
            r"sha256:[a-f0-9]{64}", self.openfga_model_sha256
        ):
            raise ValueError("OPENFGA_MODEL_SHA256 must be a lowercase SHA-256 descriptor")
        missing_schemas = sorted(expression_resources - schema_hashes.keys())
        if missing_schemas:
            raise ValueError("expression rollout resources require trusted schema hashes")
        if not self.allow_insecure_headers and not self.service_token and not self.jwt_jwks_url:
            raise ValueError("configure JWT_JWKS_URL or AUTHZ_SERVICE_TOKEN")
        if not self.allow_insecure_headers and not self.service_token:
            raise ValueError("AUTHZ_SERVICE_TOKEN is required for Envoy ext_authz")
