# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import sys
import types

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
    
    print("✅ A2A tracing disabled via monkey patching in ArgoCD agent main.py")
    
except Exception as e:
    print(f"❌ A2A tracing monkey patch failed in ArgoCD agent main.py: {e}")

import click
import httpx
from dotenv import load_dotenv

from agent_argocd.agent import ArgoCDAgent # type: ignore[import-untyped]
from agent_argocd.protocol_bindings.a2a_server.agent_executor import ArgoCDAgentExecutor # type: ignore[import-untyped]

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


@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=ArgoCDAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )
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
  """Returns the Agent Card for the ArgoCD CRUD Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='argocd',
    name='ArgoCD Operations',
    description='Performs Create, Read, Update, and Delete operations on ArgoCD applications.',
    tags=['argocd', 'kubernetes', 'continuous_deployment', 'devops'],
    examples=[
      'Create a new ArgoCD application named "my-app".',
      'Get the status of the "frontend" ArgoCD application.',
      'Update the image version for "backend" app.',
      'Delete the "test-app" from ArgoCD.'
    ],
  )
  return AgentCard(
    name='ArgoCD CRUD Agent',
    description='Agent for managing ArgoCD applications with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=ArgoCDAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=ArgoCDAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill]
  )


if __name__ == '__main__':
    main()
