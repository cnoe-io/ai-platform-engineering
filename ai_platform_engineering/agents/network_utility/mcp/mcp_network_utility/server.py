# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Network Utility MCP Server

Provides a Model Context Protocol (MCP) interface for network diagnostics,
DNS resolution, DHCP management via dnsmasq, and general network troubleshooting.
"""

import logging
import os
from dotenv import load_dotenv
from fastmcp import FastMCP

from mcp_network_utility.tools import dns
from mcp_network_utility.tools import diagnostics
from mcp_network_utility.tools import dnsmasq_config
from mcp_network_utility.tools import dhcp


def main():
    load_dotenv()

    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger("sse_starlette.sse").setLevel(logging.INFO)
    logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.INFO)

    MCP_MODE = os.getenv("MCP_MODE", "STDIO")
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info("Starting MCP server in {} mode on {}:{}".format(MCP_MODE, MCP_HOST, MCP_PORT))

    SERVER_NAME = os.getenv("SERVER_NAME", "NetworkUtility")
    logging.info("*" * 40)
    logging.info("MCP Server name: {}".format(SERVER_NAME))
    logging.info("*" * 40)

    if MCP_MODE.lower() in ["sse", "http"]:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
    else:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server")

    # DNS Tools
    mcp.tool()(dns.dns_lookup)
    mcp.tool()(dns.reverse_dns_lookup)
    mcp.tool()(dns.dns_lookup_all_records)

    # Network Diagnostics
    mcp.tool()(diagnostics.ping_host)
    mcp.tool()(diagnostics.traceroute)
    mcp.tool()(diagnostics.check_port)
    mcp.tool()(diagnostics.whois_lookup)
    mcp.tool()(diagnostics.get_network_interfaces)
    mcp.tool()(diagnostics.curl_request)

    # Dnsmasq Configuration Management
    mcp.tool()(dnsmasq_config.get_dnsmasq_config)
    mcp.tool()(dnsmasq_config.validate_dnsmasq_config)
    mcp.tool()(dnsmasq_config.list_dnsmasq_config_files)

    # DHCP Lease Management
    mcp.tool()(dhcp.list_dhcp_leases)
    mcp.tool()(dhcp.get_dhcp_lease_by_mac)
    mcp.tool()(dhcp.get_dnsmasq_logs)

    mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
    main()
