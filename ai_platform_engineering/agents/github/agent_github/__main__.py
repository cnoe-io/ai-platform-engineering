# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import sys
import types
import logging

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
try:
    # Create no-op decorators to replace a2a's trace decorators
    def noop_trace_function(func=None, **_kwargs):
        """No-op replacement for trace_function decorator."""
        if func is None:
            return lambda f: f  # Return decorator that does nothing
        return func  # Return function unchanged
    
    def noop_trace_class(cls=None, **_kwargs):
        """No-op replacement for trace_class decorator."""
        if cls is None:
            return lambda c: c  # Return decorator that does nothing
        return cls  # Return class unchanged
    
    # Create a dummy SpanKind class with required attributes
    class DummySpanKind:
        INTERNAL = 'INTERNAL'
        SERVER = 'SERVER'
        CLIENT = 'CLIENT'
        PRODUCER = 'PRODUCER'
        CONSUMER = 'CONSUMER'
    
    # Monkey patch the a2a telemetry module before it's imported anywhere
    telemetry_module = types.ModuleType('a2a.utils.telemetry')
    telemetry_module.trace_function = noop_trace_function
    telemetry_module.trace_class = noop_trace_class
    telemetry_module.SpanKind = DummySpanKind
    
    # Insert into sys.modules to intercept imports
    sys.modules['a2a.utils.telemetry'] = telemetry_module
    
    logging.debug("A2A tracing disabled via monkey patching in main.py")
    
except Exception as e:
    logging.debug(f"A2A tracing monkey patch failed in main.py: {e}")

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import httpx
from dotenv import load_dotenv

from agent_github.protocol_bindings.a2a_server.agent import GitHubAgent  # type: ignore
from agent_github.protocol_bindings.a2a_server.agent_executor import GitHubAgentExecutor  # type: ignore

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

from starlette.middleware.cors import CORSMiddleware

load_dotenv()

# Set logging level
logging.basicConfig(level=logging.INFO)

@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    print("🚀 Starting GitHub A2A Agent...")
    if not os.getenv('GITHUB_PERSONAL_ACCESS_TOKEN'):
        print('❌ GITHUB_PERSONAL_ACCESS_TOKEN environment variable not set.')
        sys.exit(1)

    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=GitHubAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    print(f"✅ Running at http://{host}:{port}/")
    print("📡 Agent ready to receive requests.\n")

    app = server.build()

    # Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
    app.add_middleware(
          CORSMiddleware,
          allow_origins=["*"],  # Allow all origins
          allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
          allow_headers=["*"],  # Allow all headers
    )

    import uvicorn
    uvicorn.run(app, host=host, port=port)


def get_agent_card(host: str, port: int):
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
    skill = AgentSkill(
        id='github',
        name='GitHub Repository Operations',
        description='Interact with GitHub repositories, issues, pull requests, and other GitHub resources via agentic tools.',
        tags=['github', 'repositories', 'issues', 'pull_requests', 'code_review'],
        examples=[
            'Create a new repository.',
            'List open pull requests in a repository.',
            'Create an issue with a detailed description.',
            'Review and merge a pull request.',
        ],
    )
    return AgentCard(
        name='GitHub Agent',
        description='Agent for managing GitHub repository operations and resources.',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=GitHubAgent.SUPPORTED_CONTENT_TYPES,
        defaultOutputModes=GitHubAgent.SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        skills=[skill],
    )

if __name__ == '__main__':
    main()
