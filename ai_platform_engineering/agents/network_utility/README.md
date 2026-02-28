# Network Utility Agent

An AI agent for network diagnostics, DNS resolution, DHCP lease management, and dnsmasq configuration management.

## Architecture

```
User → Platform Engineer (supervisor)
         → A2ARemoteAgentConnectTool("network-utility")
         → HTTP POST to agent-network-utility:8000
              → NetworkUtilityAgent (BaseLangGraphAgent)
              → MCP client → mcp-network-utility:8000 (HTTP)
                   → Network Utility MCP tools
                   → dnsmasq (config/logs/leases via shared volumes)
              → LLM
         → Response streamed back to user
```

## Components

- **Agent** (`agent_network_utility/`): A2A server wrapping a LangGraph ReAct agent
- **MCP Server** (`mcp/`): FastMCP server providing network diagnostic tools

## Capabilities

- DNS lookups (A, AAAA, CNAME, MX, NS, TXT, SOA, PTR, SRV, CAA)
- Reverse DNS lookups
- Ping, traceroute, port checks
- WHOIS lookups
- Network interface listing
- HTTP requests (GET/HEAD/OPTIONS)
- Dnsmasq configuration reading and validation
- DHCP lease listing and lookup
- Dnsmasq log reading (DHCPv4, DHCPv6, BOOTP, PXE)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_NETWORK_UTILITY` | `false` | Enable in platform engineer |
| `NETWORK_UTILITY_AGENT_HOST` | `agent-network-utility` | Agent hostname |
| `NETWORK_UTILITY_AGENT_PORT` | `8000` | Agent port |
| `MCP_MODE` | `http` | MCP transport (http/stdio) |
| `DNSMASQ_CONFIG_DIR` | `/mnt/config` | Dnsmasq config mount |
| `DNSMASQ_LEASE_FILE` | `/var/lib/misc/dnsmasq.leases` | Lease file path |
| `DNSMASQ_LOG_DIR` | `/mnt/logs` | Dnsmasq log mount |

## Running Locally

```bash
# Install dependencies
make uv-sync

# Run MCP server (stdio)
make run-mcp

# Run A2A agent
make run-a2a

# Lint
make lint
```

## Docker

```bash
# Build and run with docker-compose
docker compose --profile network-utility-agent up -d
```
