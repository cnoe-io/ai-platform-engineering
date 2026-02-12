# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Load environment variables FIRST
# =====================================================
from dotenv import load_dotenv
load_dotenv()

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import httpx
import uvicorn
import asyncio
import os
from dotenv import load_dotenv
from agntcy_app_sdk.factory import AgntcyFactory

from agent_github.protocol_bindings.a2a_server.agent_executor import GitHubAgentExecutor # type: ignore[import-untyped]
from agent_github.agentcard import create_agent_card
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import (
    BasePushNotificationSender,
    InMemoryPushNotificationConfigStore,
    InMemoryTaskStore,
)

import time
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware
from ai_platform_engineering.utils.github_app_token_provider import is_github_app_mode, get_github_token, get_token_health

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")
METRICS_ENABLED = os.getenv("METRICS_ENABLED", "false").lower() == "true"

# We can't use click decorators for async functions so we wrap the main function in a sync function
@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))

async def async_main(host: str, port: int):
    # --- GitHub Auth Health Check ---
    if is_github_app_mode():
        try:
            token = get_github_token()
            print(f"✅ GitHub App auth: token obtained (length={len(token)})")
        except Exception as e:
            print(f"❌ GitHub App auth: failed to obtain token - {e}")
    elif os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN"):
        print("⚠️  GitHub auth: using static PAT (consider switching to GitHub App for auto-refresh)")
    else:
        print("❌ GitHub auth: no credentials configured")

    client = httpx.AsyncClient()
    push_config_store = InMemoryPushNotificationConfigStore()
    push_sender = BasePushNotificationSender(httpx_client=client,
                    config_store=push_config_store)
    request_handler = DefaultRequestHandler(
        agent_executor=GitHubAgentExecutor(),
        task_store=InMemoryTaskStore(),
      push_config_store=push_config_store,
      push_sender= push_sender
    )

    if A2A_TRANSPORT == "slim":
        agent_url = SLIM_ENDPOINT
    else:
        agent_url = f'http://{host}:{port}'

    server = A2AStarletteApplication(
        agent_card=create_agent_card(agent_url), http_handler=request_handler
    )

    if A2A_TRANSPORT == 'slim':
        # Run A2A server over SLIM transport
        # https://docs.agntcy.org/messaging/slim-core/
        print("Running A2A server in SLIM mode.")
        factory = AgntcyFactory()
        transport = factory.create_transport("SLIM", endpoint=agent_url)
        print("Transport created successfully.")

        bridge = factory.create_bridge(server, transport=transport)
        print("Bridge created successfully. Starting the bridge.")
        await bridge.start(blocking=True)
    else:
        # Run a p2p A2A server
        print("Running A2A server in p2p mode.")
        app = server.build()

        # --- Health endpoints ---
        async def healthz_endpoint(request):
            """Health check endpoint with GitHub token expiry details."""
            token_health = get_token_health()
            overall_status = "healthy" if token_health.get("has_token") else "unhealthy"
            return JSONResponse({
                "status": overall_status,
                "agent": "github",
                "timestamp": int(time.time()),
                "github_auth": token_health,
            }, status_code=200 if overall_status == "healthy" else 503)

        async def health_endpoint(request):
            """Basic liveness check."""
            return JSONResponse({"status": "ok"})

        async def ready_endpoint(request):
            """Readiness check - verifies GitHub token is available."""
            token_health = get_token_health()
            if token_health.get("has_token"):
                return JSONResponse({"status": "ready"})
            return JSONResponse({"status": "not_ready", "reason": "no GitHub token"}, status_code=503)

        app.routes.append(Route("/healthz", healthz_endpoint, methods=["GET"]))
        app.routes.append(Route("/health", health_endpoint, methods=["GET"]))
        app.routes.append(Route("/ready", ready_endpoint, methods=["GET"]))

        # Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # Allow all origins
            allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
            allow_headers=["*"],  # Allow all headers
        )

        # Add Prometheus metrics middleware if enabled
        if METRICS_ENABLED:
            app.add_middleware(
                PrometheusMetricsMiddleware,
                excluded_paths=["/.well-known/agent.json", "/.well-known/agent-card.json", "/health", "/healthz", "/ready"],
                metrics_path="/metrics",
                agent_name="github",
            )

        # Disable uvicorn access logs to reduce noise from health checks
        config = uvicorn.Config(app, host=host, port=port, access_log=False)
        server = uvicorn.Server(config=config)
        await server.serve()

if __name__ == '__main__':
    main()
