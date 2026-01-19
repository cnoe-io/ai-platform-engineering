# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

AGENT_NAME = 'istio'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to manage Istio service mesh resources including virtual services, destination rules, gateways, and traffic management.'

agent_skill = AgentSkill(
  id="istio_agent_skill",
  name="Istio Service Mesh Agent Skill",
  description="Provides capabilities to manage Istio service mesh configuration and traffic management.",
  tags=[
    "istio",
    "service-mesh",
    "traffic-management",
    "virtual-service",
    "gateway"],
  examples=[
      # Virtual Services
      "List all virtual services in namespace 'default'.",
      "Get the virtual service 'my-app' in namespace 'production'.",
      "Create a virtual service to route traffic to my-app v2.",
      "Delete the virtual service 'old-routing'.",

      # Destination Rules
      "List all destination rules in namespace 'default'.",
      "Create a destination rule with circuit breaker for 'my-service'.",
      "Get destination rule details for 'my-service'.",

      # Gateways
      "List all Istio gateways.",
      "Create a gateway for domain 'myapp.example.com'.",
      "Get gateway configuration for 'my-gateway'.",

      # Traffic Management
      "Route 80% of traffic to v1 and 20% to v2 for 'my-app'.",
      "Add a 5 second timeout for requests to 'slow-service'.",
      "Configure retry policy for 'my-service' with 3 retries.",
      "Add fault injection to 'test-service' with 50% delay.",

      # Service Entries
      "List all service entries.",
      "Create a service entry for external API 'api.external.com'.",

      # Sidecar Configuration
      "Get sidecar configuration for namespace 'production'.",
      "List all sidecars in the mesh.",

      # Authorization Policies
      "List authorization policies in namespace 'default'.",
      "Create an authorization policy to allow traffic from 'frontend' to 'backend'.",

      # Peer Authentication
      "Get peer authentication policy for namespace 'production'.",
      "Enable strict mTLS for namespace 'secure'.",

      # Mesh Status
      "Show Istio mesh status.",
      "List all proxies in the mesh.",
      "Check if Istio is properly injected in namespace 'default'.",
  ])

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
    security=[{"public": []}],
  )
