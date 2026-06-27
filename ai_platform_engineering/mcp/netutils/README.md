# NetUtils MCP Server

MCP server providing network diagnostic and DHCP/DNS management tools via dnsmasq.

## Tools

### DNS
- `dns_lookup` - DNS record lookup (A, AAAA, CNAME, MX, NS, TXT, SOA, PTR, SRV, CAA)
- `reverse_dns_lookup` - Reverse DNS (PTR) lookup from IP address
- `dns_lookup_all_records` - Query all common record types in parallel

### Network Diagnostics
- `ping_host` - ICMP ping with latency stats
- `traceroute` - Network path tracing
- `check_port` - TCP port connectivity check
- `whois_lookup` - WHOIS domain/IP registration info
- `get_network_interfaces` - List host network interfaces
- `curl_request` - HTTP GET/HEAD/OPTIONS requests

### Dnsmasq Configuration
- `get_dnsmasq_config` - Read dnsmasq configuration files
- `validate_dnsmasq_config` - Validate configuration syntax
- `list_dnsmasq_config_files` - List config files and sizes

### DHCP Management
- `list_dhcp_leases` - List active DHCP leases
- `get_dhcp_lease_by_mac` - Find lease by MAC address
- `get_dnsmasq_logs` - Read dnsmasq logs (DHCPv4/v6, BOOTP, PXE)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_MODE` | `STDIO` | Transport mode: `stdio`, `http`, or `sse` |
| `MCP_HOST` | `localhost` | Bind host (for http/sse mode) |
| `MCP_PORT` | `8000` | Bind port (for http/sse mode) |
| `DNSMASQ_CONFIG_DIR` | `/mnt/config` | Path to dnsmasq config directory |
| `DNSMASQ_LEASE_FILE` | `/var/lib/misc/dnsmasq.leases` | Path to DHCP lease file |
| `DNSMASQ_LOG_DIR` | `/mnt/logs` | Path to dnsmasq log directory |

## Running

```bash
# stdio mode (for local agent use)
uv run python -m mcp_netutils

# HTTP mode (for Docker/remote use)
MCP_MODE=http MCP_HOST=0.0.0.0 MCP_PORT=8000 uv run python -m mcp_netutils
```
