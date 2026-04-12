# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import asyncio
import os
from dotenv import load_dotenv

from agent_netutils.protocol_bindings.a2a_server.agent_executor import NetUtilsAgentExecutor  # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import AgentSkill

load_dotenv()

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"

AGENT_NAME = "netutils"
AGENT_DESCRIPTION = (
    "An AI agent that provides network diagnostics, DNS resolution, "
    "DHCP lease management, and dnsmasq configuration utilities."
)

agent_skill = AgentSkill(
    id="netutils_agent_skill",
    name="NetUtils Agent Skill",
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


@click.command()
@click.option("--host", "host", default="localhost")
@click.option("--port", "port", default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))


async def async_main(host: str, port: int):
    server = A2AServer(
        agent_name=AGENT_NAME,
        agent_description=AGENT_DESCRIPTION,
        agent_skills=[agent_skill],
        host=host,
        port=port,
        agent_executor=NetUtilsAgentExecutor(),
        metrics_enabled=METRICS_ENABLED,
    )

    await server.serve()


if __name__ == "__main__":
    main()
