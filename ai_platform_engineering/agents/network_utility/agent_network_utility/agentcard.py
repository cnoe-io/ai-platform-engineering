# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# ==================================================
AGENT_NAME = "network_utility"
AGENT_DESCRIPTION = (
    "An AI agent that provides network diagnostics, DNS resolution, "
    "DHCP lease management, and dnsmasq configuration utilities."
)

agent_skill = AgentSkill(
    id="network_utility_agent_skill",
    name="Network Utility Agent Skill",
    description=(
        "Provides capabilities for DNS lookups, network diagnostics (ping, traceroute, port checks), "
        "DHCP lease management, and dnsmasq configuration management."
    ),
    tags=[
        "network",
        "dns",
        "dhcp",
        "dnsmasq",
        "ping",
        "traceroute",
        "diagnostics",
    ],
    examples=[
        "Look up the DNS A record for example.com",
        "Perform a reverse DNS lookup for 8.8.8.8",
        "Ping google.com with 5 packets",
        "Traceroute to 10.0.0.1",
        "Check if port 443 is open on example.com",
        "Show all DHCP leases",
        "Find the DHCP lease for MAC address 00:11:22:33:44:55",
        "Show the dnsmasq configuration",
        "Validate the dnsmasq configuration",
        "Show dnsmasq logs",
        "What are my network interfaces?",
        "WHOIS lookup for example.com",
        "Look up all DNS record types for example.com",
        "Curl https://httpbin.org/get",
    ],
)

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# ==================================================
SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)


def create_agent_card(agent_url: str) -> AgentCard:
    """Create the agent card for the Network Utility agent."""
    print("===================================")
    print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
    print("===================================")
    print(f"AGENT_URL: {agent_url}")
    print("===================================")

    return AgentCard(
        name=AGENT_NAME,
        id=f"{AGENT_NAME.lower()}-tools-agent",
        description=AGENT_DESCRIPTION,
        url=agent_url,
        version="0.1.0",
        defaultInputModes=SUPPORTED_CONTENT_TYPES,
        defaultOutputModes=SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        skills=[agent_skill],
        security=[{"public": []}],
    )
