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
from starlette.middleware import Middleware
from mcp_agent_auth.middleware import MCPAuthMiddleware

from mcp_netutils.tools import dns
from mcp_netutils.tools import diagnostics
from mcp_netutils.tools import dnsmasq_config
from mcp_netutils.tools import dhcp
from mcp_netutils.tools import advanced_networking
from mcp_netutils.tools import cisco
from mcp_netutils.tools import ip_planning


def main():
    load_dotenv()

    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger("sse_starlette.sse").setLevel(logging.INFO)
    logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.INFO)

    MCP_MODE = os.getenv("MCP_MODE", "STDIO")
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info("Starting MCP server in {} mode on {}:{}".format(MCP_MODE, MCP_HOST, MCP_PORT))

    SERVER_NAME = os.getenv("SERVER_NAME", "NetUtils")
    logging.info("*" * 40)
    logging.info("MCP Server name: {}".format(SERVER_NAME))
    logging.info("*" * 40)

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

    # Advanced Networking
    mcp.tool()(advanced_networking.mtr_report)
    mcp.tool()(advanced_networking.nmap_port_scan)
    mcp.tool()(advanced_networking.show_arp_table)
    mcp.tool()(advanced_networking.show_routing_table)
    mcp.tool()(advanced_networking.show_socket_stats)
    mcp.tool()(advanced_networking.check_ssl_certificate)
    mcp.tool()(advanced_networking.check_mtu)

    # Cisco-centric Tools
    mcp.tool()(cisco.snmp_get)
    mcp.tool()(cisco.snmp_walk)
    mcp.tool()(cisco.lldp_neighbors)
    mcp.tool()(cisco.subnet_calculator)
    mcp.tool()(cisco.subnet_contains_ip)
    mcp.tool()(cisco.parse_cisco_config)
    mcp.tool()(cisco.analyze_cisco_acl)

    # IP Planning, CIDR & VLAN Tools
    mcp.tool()(ip_planning.split_cidr)
    mcp.tool()(ip_planning.aggregate_cidrs)
    mcp.tool()(ip_planning.find_available_subnets)
    mcp.tool()(ip_planning.compare_cidrs)
    mcp.tool()(ip_planning.analyze_vlan_config)
    mcp.tool()(ip_planning.plan_vlan_subnets)
    mcp.tool()(ip_planning.generate_network_diagram)
    mcp.tool()(ip_planning.generate_subnet_map)

    if MCP_MODE.lower() == "http":
        mcp.run(transport=MCP_MODE.lower(), host=MCP_HOST, port=MCP_PORT, middleware=[Middleware(MCPAuthMiddleware)])
    else:
        mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
    main()
