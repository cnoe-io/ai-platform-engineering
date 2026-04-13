# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

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
import asyncio
import os
from dotenv import load_dotenv

from agent_petstore.protocol_bindings.a2a_server.agent_executor import PetStoreAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"

AGENT_NAME = 'petstore'
AGENT_DESCRIPTION = (
  "A comprehensive petstore management AI agent that handles pet inventory, customer orders, and user accounts. "
  "Provides full CRUD operations for pets, order processing, user management, and store analytics."
)

agent_skill = AgentSkill(
  id="petstore_agent_skill",
  name="Petstore Management",
  description="Manages pets, orders, and users in the petstore system with comprehensive CRUD operations.",
  tags=[
    "petstore",
    "pets",
    "ecommerce",
    "inventory",
    "orders",
    "users"],
    examples=[
      # Discovery & Getting Started
      "What actions can you perform?",
      "Show me what you can do with pets",
      # Simple Pet Queries (work immediately)
      "Find all available pets in the store",
      "Get all cats that are pending",
      "Show me dogs with 'sold' status",
      "Get a summary of pets by status",
      "Show me pets with 'friendly' tags",
      # Interactive Operations (will ask for details)
      "I want to add a new pet to the store",
      "Help me place an order for a pet",
      "Create a user account for me",
      # Advanced Operations
      "Check current store inventory levels",
      "Update information for pet ID 12345"
  ])

# We can't use click decorators for async functions so we wrap the main function in a sync function
@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))

async def async_main(host: str, port: int):
    server = A2AServer(
        agent_name=AGENT_NAME,
        agent_description=AGENT_DESCRIPTION,
        agent_skills=[agent_skill],
        host=host,
        port=port,
        agent_executor=PetStoreAgentExecutor(),
        metrics_enabled=METRICS_ENABLED,
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
