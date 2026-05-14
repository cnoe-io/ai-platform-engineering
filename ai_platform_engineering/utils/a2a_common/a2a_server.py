# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os
from typing import List

import httpx
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.types import (
  AgentCard,
  AgentSkill,
  AgentCapabilities
)
from a2a.server.tasks import (
    BasePushNotificationSender,
    InMemoryPushNotificationConfigStore,
    InMemoryTaskStore,
)

from starlette.middleware.cors import CORSMiddleware
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware

logger = logging.getLogger(__name__)

SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

def _build_security_for_card():
    """Decide AgentCard `security` and `security_schemes` based on env.

    When A2A_AUTH_OAUTH2=true and TOKEN_ENDPOINT is set, the AgentCard
    advertises an OAuth2 client_credentials security scheme so A2A clients
    (e.g. the supervisor's A2ARemoteAgentConnectTool + AuthInterceptor)
    know to attach a Bearer token when calling this agent. Otherwise the
    AgentCard remains unchanged: security=[{"public": []}].

    Returns:
        tuple of (security_list, security_schemes_dict | None)
    """
    if os.getenv('A2A_AUTH_OAUTH2', 'false').lower() != 'true':
        return [{"public": []}], None

    # Lazy imports so unauthenticated agents don't pay the cost.
    from a2a.types import (
        ClientCredentialsOAuthFlow,
        OAuth2SecurityScheme,
        OAuthFlows,
        SecurityScheme,
    )

    token_endpoint = os.environ.get('TOKEN_ENDPOINT')
    if not token_endpoint:
        # OAuth2 enabled but no token endpoint configured. The AgentCard
        # falls back to public, but the inbound OAuth2Middleware will
        # still enforce JWT validation if A2A_AUTH_OAUTH2=true — anonymous
        # requests will receive 401. This soft-fall-back exists only so
        # the misconfiguration surfaces via a warning instead of a crash
        # loop. Operators should set TOKEN_ENDPOINT to match the IdP
        # (typically `<ISSUER>/protocol/openid-connect/token` for Keycloak).
        logger.warning(
            "A2A_AUTH_OAUTH2=true but TOKEN_ENDPOINT not set — AgentCard "
            "will advertise security=[{public: []}]; inbound middleware "
            "will still reject anonymous requests with 401. Set "
            "TOKEN_ENDPOINT so A2A clients can discover the token URL."
        )
        return [{"public": []}], None

    # Warn (not reject) if the token endpoint is plaintext on a non-loopback
    # host. Plaintext token endpoints leak client_secret on each mint and
    # are appropriate only for local development.
    from urllib.parse import urlparse as _urlparse
    _parsed = _urlparse(token_endpoint)
    if _parsed.scheme == 'http' and _parsed.hostname not in {
        'localhost', '127.0.0.1', '::1'
    }:
        logger.warning(
            "TOKEN_ENDPOINT advertised on AgentCard uses plaintext http:// "
            "(host=%s). A2A clients minting tokens against this endpoint "
            "will send client_secret in plaintext. Use https:// in any "
            "non-loopback environment.",
            _parsed.hostname,
        )

    issuer = (os.environ.get('ISSUER') or '').rstrip('/')
    metadata_url = (
        f"{issuer}/.well-known/openid-configuration" if issuer else None
    )
    logger.info(
        "[a2a_server] OAuth2 enabled. ISSUER=%s, AUDIENCE=%s, JWKS_URI=%s, "
        "ALLOWED_ALGORITHMS=%s, TOKEN_ENDPOINT=%s",
        issuer,
        os.environ.get('AUDIENCE'),
        os.environ.get('JWKS_URI'),
        os.environ.get('ALLOWED_ALGORITHMS', 'RS256,ES256'),
        token_endpoint,
    )
    schemes = {
        'oauth2': SecurityScheme(
            root=OAuth2SecurityScheme(
                description='OAuth2 client_credentials for A2A',
                flows=OAuthFlows(
                    client_credentials=ClientCredentialsOAuthFlow(
                        token_url=token_endpoint,
                        # Empty scope map: this implementation does not
                        # currently enforce scope-based authorization. The
                        # inbound OAuth2Middleware authorizes via the
                        # OAUTH2_CLIENT_ID allowlist (azp/client_id/cid
                        # claim), not via OAuth scopes.
                        scopes={},
                    ),
                ),
                oauth2_metadata_url=metadata_url,
            )
        ),
    }
    return [{'oauth2': []}], schemes


class A2AServer:
    def __init__(self, agent_name: str, agent_description: str, agent_skills: List[AgentSkill], host: str, port: int, agent_executor: AgentExecutor, metrics_enabled: bool = False, version: str = '0.1.0'):
        self.agent_name = agent_name
        self.host = host
        self.port = port

        security, security_schemes = _build_security_for_card()

        self.agent_card = AgentCard(
            name=agent_name,
            id=f'{agent_name.lower()}-tools-agent',
            url=f'http://{host}:{port}',
            description=agent_description,
            version=version,
            defaultInputModes=SUPPORTED_CONTENT_TYPES,
            defaultOutputModes=SUPPORTED_CONTENT_TYPES,
            capabilities=AgentCapabilities(streaming=True, pushNotifications=True),
            skills=agent_skills,
            security=security,
            securitySchemes=security_schemes,
        )
        self.agent_executor = agent_executor
        self.metrics_enabled = metrics_enabled

    def build_app(self):
        """Build and return the configured ASGI app. Useful for testing."""
        client = httpx.AsyncClient()
        push_config_store = InMemoryPushNotificationConfigStore()
        push_sender = BasePushNotificationSender(httpx_client=client, config_store=push_config_store)
        request_handler = DefaultRequestHandler(
            agent_executor=self.agent_executor,
            task_store=InMemoryTaskStore(),
            push_config_store=push_config_store,
            push_sender=push_sender,
        )

        app = A2AStarletteApplication(
            agent_card=self.agent_card,
            http_handler=request_handler,
        ).build()

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        if self.metrics_enabled:
            app.add_middleware(
                PrometheusMetricsMiddleware,
                excluded_paths=["/.well-known/agent.json", "/.well-known/agent-card.json", "/health", "/ready"],
                metrics_path="/metrics",
                agent_name=self.agent_name,
            )

        return app

    async def serve(self):
        app = self.build_app()
        config = uvicorn.Config(app, host=self.host, port=self.port, access_log=False)
        await uvicorn.Server(config).serve()