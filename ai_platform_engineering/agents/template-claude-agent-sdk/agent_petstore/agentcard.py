# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# Modify these values for your specific agent
# ==================================================
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

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# This section is reusable across all agents
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{AGENT_NAME.lower()}-tools-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill],
    # Using the security field instead of the non-existent AgentAuthentication class
    security=[{"public": []}],
  )
