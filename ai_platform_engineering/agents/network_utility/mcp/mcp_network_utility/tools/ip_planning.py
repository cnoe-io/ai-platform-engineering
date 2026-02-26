# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""IP planning tools: CIDR splitting/aggregation, VLAN analysis, network diagramming."""

import ipaddress
import logging
import re
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CIDR Analysis & Manipulation
# ---------------------------------------------------------------------------

async def split_cidr(
    network: str,
    new_prefix: int,
) -> Dict[str, Any]:
    """
    Split a CIDR network into smaller subnets of a given prefix length.

    For example, split 10.0.0.0/16 into /24 subnets or 192.168.0.0/24 into /28 subnets.
    Commonly used when planning Cisco VLAN subnetting or AWS VPC subnet allocation.

    Args:
        network: CIDR notation network to split (e.g., '10.0.0.0/16').
        new_prefix: Target prefix length for the subnets (must be larger than current prefix).

    Returns:
        Dict with the list of resulting subnets, their count, and per-subnet host capacity.
    """
    try:
        net = ipaddress.ip_network(network, strict=False)
    except ValueError as e:
        return {"error": f"Invalid network: {e}"}

    if new_prefix <= net.prefixlen:
        return {
            "error": (
                f"New prefix /{new_prefix} must be larger than current /{net.prefixlen}. "
                f"Splitting means making subnets smaller (bigger prefix number)."
            )
        }

    max_prefix = 32 if net.version == 4 else 128
    if new_prefix > max_prefix:
        return {"error": f"Prefix /{new_prefix} exceeds maximum /{max_prefix} for IPv{net.version}"}

    subnets = list(net.subnets(new_prefix=new_prefix))

    if len(subnets) > 1024:
        subnet_list = [_subnet_info(s) for s in subnets[:100]]
        return {
            "parent": str(net),
            "new_prefix": new_prefix,
            "total_subnets": len(subnets),
            "subnets": subnet_list,
            "note": f"Showing first 100 of {len(subnets)} subnets. Use a smaller prefix difference for fewer results.",
        }

    return {
        "parent": str(net),
        "new_prefix": new_prefix,
        "total_subnets": len(subnets),
        "hosts_per_subnet": max(subnets[0].num_addresses - 2, 0) if net.version == 4 else subnets[0].num_addresses,
        "subnets": [_subnet_info(s) for s in subnets],
    }


async def aggregate_cidrs(
    networks: List[str],
) -> Dict[str, Any]:
    """
    Aggregate (summarize) a list of CIDR networks into the smallest set of supernets.

    Takes multiple subnets and collapses them into the fewest possible CIDR blocks.
    Essential for optimizing Cisco route summarization and firewall rule consolidation.

    Example: ['10.0.0.0/24', '10.0.1.0/24'] -> ['10.0.0.0/23']

    Args:
        networks: List of CIDR networks to aggregate (e.g., ['10.0.0.0/24', '10.0.1.0/24']).

    Returns:
        Dict with the original networks, aggregated result, and reduction stats.
    """
    if not networks:
        return {"error": "No networks provided"}
    if len(networks) > 500:
        return {"error": "Too many networks (max 500)"}

    parsed = []
    errors = []
    for n in networks:
        try:
            parsed.append(ipaddress.ip_network(n.strip(), strict=False))
        except ValueError as e:
            errors.append(f"{n}: {e}")

    if errors:
        return {"error": f"Invalid networks: {'; '.join(errors)}"}

    v4 = [n for n in parsed if n.version == 4]
    v6 = [n for n in parsed if n.version == 6]

    result: Dict[str, Any] = {
        "input_count": len(networks),
    }

    if v4:
        collapsed = list(ipaddress.collapse_addresses(v4))
        result["ipv4"] = {
            "input_count": len(v4),
            "aggregated_count": len(collapsed),
            "reduction": f"{len(v4)} -> {len(collapsed)}",
            "aggregated": [str(n) for n in collapsed],
        }

    if v6:
        collapsed = list(ipaddress.collapse_addresses(v6))
        result["ipv6"] = {
            "input_count": len(v6),
            "aggregated_count": len(collapsed),
            "reduction": f"{len(v6)} -> {len(collapsed)}",
            "aggregated": [str(n) for n in collapsed],
        }

    return result


async def find_available_subnets(
    parent_network: str,
    allocated_networks: List[str],
    target_prefix: int,
    max_results: int = 20,
) -> Dict[str, Any]:
    """
    Find available (unallocated) subnets within a parent network.

    Given a parent CIDR and a list of already-allocated subnets, finds gaps where
    new subnets of a target size can be allocated. Useful for IP address planning
    in data center and campus networks.

    Args:
        parent_network: The parent CIDR block (e.g., '10.0.0.0/16').
        allocated_networks: List of already-allocated CIDRs within the parent.
        target_prefix: Desired prefix length for new subnets (e.g., 24 for /24).
        max_results: Maximum number of available subnets to return. Defaults to 20.

    Returns:
        Dict with available subnets and allocation summary.
    """
    try:
        parent = ipaddress.ip_network(parent_network, strict=False)
    except ValueError as e:
        return {"error": f"Invalid parent network: {e}"}

    if target_prefix <= parent.prefixlen:
        return {"error": f"Target prefix /{target_prefix} must be larger than parent /{parent.prefixlen}"}

    allocated = []
    for n in allocated_networks:
        try:
            net = ipaddress.ip_network(n.strip(), strict=False)
            if net.subnet_of(parent):
                allocated.append(net)
        except (ValueError, TypeError):
            continue

    all_target_subnets = list(parent.subnets(new_prefix=target_prefix))
    if len(all_target_subnets) > 10000:
        return {
            "error": (
                f"Too many possible subnets ({len(all_target_subnets)}). "
                f"Use a smaller prefix difference."
            )
        }

    available = []
    for candidate in all_target_subnets:
        is_allocated = any(candidate.overlaps(a) for a in allocated)
        if not is_allocated:
            available.append(candidate)
        if len(available) >= max_results:
            break

    total_possible = len(all_target_subnets)
    total_allocated = len([s for s in all_target_subnets if any(s.overlaps(a) for a in allocated)])

    return {
        "parent": str(parent),
        "target_prefix": target_prefix,
        "total_possible_subnets": total_possible,
        "allocated_count": total_allocated,
        "available_count": total_possible - total_allocated,
        "utilization_pct": round(total_allocated / total_possible * 100, 1) if total_possible else 0,
        "available_subnets": [_subnet_info(s) for s in available],
        "note": f"Showing first {max_results} available" if len(available) == max_results else None,
    }


async def compare_cidrs(
    network_a: str,
    network_b: str,
) -> Dict[str, Any]:
    """
    Compare two CIDR networks and determine their relationship.

    Checks if networks overlap, if one contains the other, or if they are adjacent
    and could be aggregated. Useful for validating routing table entries and ACL rules.

    Args:
        network_a: First CIDR network (e.g., '10.0.0.0/24').
        network_b: Second CIDR network (e.g., '10.0.1.0/24').

    Returns:
        Dict with relationship type, overlap details, and aggregation possibility.
    """
    try:
        a = ipaddress.ip_network(network_a, strict=False)
        b = ipaddress.ip_network(network_b, strict=False)
    except ValueError as e:
        return {"error": f"Invalid network: {e}"}

    if a.version != b.version:
        return {
            "network_a": str(a),
            "network_b": str(b),
            "relationship": "incompatible",
            "detail": "Cannot compare IPv4 and IPv6 networks",
        }

    result: Dict[str, Any] = {
        "network_a": _subnet_info(a),
        "network_b": _subnet_info(b),
    }

    if a == b:
        result["relationship"] = "identical"
    elif a.subnet_of(b):
        result["relationship"] = "a_is_subnet_of_b"
        result["detail"] = f"{a} is contained within {b}"
    elif b.subnet_of(a):
        result["relationship"] = "b_is_subnet_of_a"
        result["detail"] = f"{b} is contained within {a}"
    elif a.overlaps(b):
        result["relationship"] = "overlapping"
        result["detail"] = "Networks share some addresses (potential conflict)"
    else:
        result["relationship"] = "disjoint"

    collapsed = list(ipaddress.collapse_addresses([a, b]))
    if len(collapsed) == 1:
        result["can_aggregate"] = True
        result["aggregated"] = str(collapsed[0])
    else:
        result["can_aggregate"] = False

    return result


# ---------------------------------------------------------------------------
# VLAN Analysis
# ---------------------------------------------------------------------------

async def analyze_vlan_config(
    config_text: str,
) -> Dict[str, Any]:
    """
    Analyze VLAN configuration from Cisco IOS/NX-OS output.

    Parses 'show vlan brief' or running-config VLAN sections to provide a structured
    breakdown of VLANs, their names, assigned ports, and identifies potential issues
    like unused VLANs or VLAN range gaps.

    Args:
        config_text: Raw VLAN configuration text (from 'show vlan brief',
            'show vlan', or running-config VLAN sections).

    Returns:
        Dict with parsed VLANs, port assignments, and analysis warnings.
    """
    if not config_text or not config_text.strip():
        return {"error": "No VLAN configuration text provided"}

    if len(config_text) > 200000:
        return {"error": "Config too large (max 200KB)"}

    vlans: List[Dict[str, Any]] = []
    warnings: List[str] = []
    lines = config_text.strip().split("\n")

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("-"):
            continue

        vlan_brief = re.match(
            r"^(\d+)\s+(\S+)\s+(active|act/unsup|suspend)\s*(.*)?$",
            stripped, re.IGNORECASE
        )
        if vlan_brief:
            vlan_id = int(vlan_brief.group(1))
            name = vlan_brief.group(2)
            status = vlan_brief.group(3)
            ports = vlan_brief.group(4).strip() if vlan_brief.group(4) else ""

            vlan_entry: Dict[str, Any] = {
                "id": vlan_id,
                "name": name,
                "status": status,
                "ports": [p.strip() for p in ports.split(",") if p.strip()] if ports else [],
            }
            vlans.append(vlan_entry)

            if not ports and vlan_id not in (1, 1002, 1003, 1004, 1005):
                warnings.append(f"VLAN {vlan_id} ({name}) has no ports assigned")
            if "suspend" in status.lower():
                warnings.append(f"VLAN {vlan_id} ({name}) is suspended")
            continue

        vlan_config = re.match(r"^vlan\s+(\d+)$", stripped)
        if vlan_config:
            vlans.append({"id": int(vlan_config.group(1)), "source": "config"})

    if vlans:
        vlan_ids = sorted(set(v["id"] for v in vlans))
        if len(vlan_ids) > 1:
            gaps = []
            for i in range(len(vlan_ids) - 1):
                if vlan_ids[i + 1] - vlan_ids[i] > 1:
                    gap_start = vlan_ids[i] + 1
                    gap_end = vlan_ids[i + 1] - 1
                    if gap_start == gap_end:
                        gaps.append(str(gap_start))
                    else:
                        gaps.append(f"{gap_start}-{gap_end}")
            if gaps:
                warnings.append(f"VLAN ID gaps detected: {', '.join(gaps)}")

    return {
        "total_vlans": len(vlans),
        "vlans": vlans,
        "vlan_id_range": f"{min(v['id'] for v in vlans)}-{max(v['id'] for v in vlans)}" if vlans else "N/A",
        "warnings": warnings if warnings else None,
    }


async def plan_vlan_subnets(
    parent_network: str,
    vlans: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Plan IP subnets for a set of VLANs within a parent network.

    Given a parent CIDR block and a list of VLANs with required host counts,
    automatically assigns optimally-sized subnets to each VLAN. Uses variable-length
    subnet masking (VLSM) to minimize IP waste.

    Args:
        parent_network: Parent CIDR to allocate from (e.g., '10.0.0.0/16').
        vlans: List of VLAN definitions, each with 'id', 'name', and 'hosts' (required host count).
            Example: [{"id": 10, "name": "Data", "hosts": 200}, {"id": 20, "name": "Voice", "hosts": 50}]

    Returns:
        Dict with subnet assignments per VLAN, gateway addresses, and utilization stats.
    """
    try:
        parent = ipaddress.ip_network(parent_network, strict=False)
    except ValueError as e:
        return {"error": f"Invalid parent network: {e}"}

    if not vlans:
        return {"error": "No VLANs provided"}
    if len(vlans) > 200:
        return {"error": "Too many VLANs (max 200)"}

    sorted_vlans = sorted(vlans, key=lambda v: v.get("hosts", 0), reverse=True)

    allocations: List[Dict[str, Any]] = []
    allocated_nets: List[ipaddress.IPv4Network] = []
    errors: List[str] = []

    for vlan in sorted_vlans:
        vlan_id = vlan.get("id", "?")
        vlan_name = vlan.get("name", f"VLAN{vlan_id}")
        hosts_needed = vlan.get("hosts", 0)

        if hosts_needed <= 0:
            errors.append(f"VLAN {vlan_id}: invalid host count {hosts_needed}")
            continue

        total_needed = hosts_needed + 2
        prefix = 32
        while (1 << (32 - prefix)) < total_needed and prefix > 0:
            prefix -= 1

        found = False
        for candidate in parent.subnets(new_prefix=prefix):
            overlap = any(candidate.overlaps(a) for a in allocated_nets)
            if not overlap:
                allocated_nets.append(candidate)
                net_info = _subnet_info(candidate)
                allocations.append({
                    "vlan_id": vlan_id,
                    "vlan_name": vlan_name,
                    "hosts_requested": hosts_needed,
                    "subnet": str(candidate),
                    "netmask": net_info.get("netmask"),
                    "wildcard_mask": net_info.get("wildcard_mask"),
                    "gateway": str(candidate.network_address + 1),
                    "dhcp_range_start": str(candidate.network_address + 2),
                    "dhcp_range_end": str(candidate.broadcast_address - 1),
                    "usable_hosts": net_info.get("usable_hosts"),
                    "utilization_pct": round(hosts_needed / max(net_info.get("usable_hosts", 1), 1) * 100, 1),
                })
                found = True
                break

        if not found:
            errors.append(f"VLAN {vlan_id} ({vlan_name}): no space for {hosts_needed} hosts (/{prefix})")

    total_used = sum(a.num_addresses for a in allocated_nets)
    return {
        "parent_network": str(parent),
        "total_parent_addresses": parent.num_addresses,
        "allocated_addresses": total_used,
        "remaining_addresses": parent.num_addresses - total_used,
        "parent_utilization_pct": round(total_used / parent.num_addresses * 100, 1),
        "allocations": allocations,
        "errors": errors if errors else None,
    }


# ---------------------------------------------------------------------------
# Network Diagram Generation
# ---------------------------------------------------------------------------

async def generate_network_diagram(
    topology: Dict[str, Any],
    format: str = "mermaid",
) -> Dict[str, Any]:
    """
    Generate a network topology diagram from structured topology data.

    Creates a visual network diagram in Mermaid or ASCII format showing devices,
    connections, VLANs, and subnets. The output can be rendered in Markdown,
    documentation tools, or Cisco network planning documents.

    Args:
        topology: Network topology definition with 'devices' and 'connections'.
            devices: List of dicts with 'name', 'type' (router/switch/firewall/server/cloud),
                and optional 'ip', 'interfaces'.
            connections: List of dicts with 'from', 'to', and optional 'label',
                'interface_from', 'interface_to'.
            Example:
            {
                "devices": [
                    {"name": "core-rtr-01", "type": "router", "ip": "10.0.0.1"},
                    {"name": "dist-sw-01", "type": "switch"},
                    {"name": "fw-01", "type": "firewall", "ip": "10.0.0.2"}
                ],
                "connections": [
                    {"from": "core-rtr-01", "to": "dist-sw-01", "label": "Gi0/0 - VLAN 10"},
                    {"from": "core-rtr-01", "to": "fw-01", "label": "Gi0/1 - DMZ"}
                ]
            }
        format: Output format - 'mermaid' (default) or 'ascii'.

    Returns:
        Dict with the generated diagram text ready for rendering.
    """
    if not topology:
        return {"error": "No topology data provided"}

    devices = topology.get("devices", [])
    connections = topology.get("connections", [])

    if not devices:
        return {"error": "No devices in topology"}

    if format == "mermaid":
        return _generate_mermaid(devices, connections)
    elif format == "ascii":
        return _generate_ascii(devices, connections)
    else:
        return {"error": f"Unknown format: {format}. Use 'mermaid' or 'ascii'."}


async def generate_subnet_map(
    networks: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Generate a visual subnet map showing network hierarchy and IP allocation.

    Creates a Mermaid diagram showing parent/child subnet relationships,
    utilization, and VLAN assignments. Useful for documenting IP address plans
    and presenting to network teams.

    Args:
        networks: List of network definitions with 'cidr', and optional 'name', 'vlan', 'usage'.
            Example:
            [
                {"cidr": "10.0.0.0/16", "name": "Campus Network"},
                {"cidr": "10.0.1.0/24", "name": "Data VLAN", "vlan": 10},
                {"cidr": "10.0.2.0/24", "name": "Voice VLAN", "vlan": 20},
                {"cidr": "10.0.10.0/24", "name": "Management", "vlan": 99}
            ]

    Returns:
        Dict with Mermaid diagram text showing the subnet hierarchy.
    """
    if not networks:
        return {"error": "No networks provided"}

    parsed = []
    for n in networks:
        try:
            net = ipaddress.ip_network(n["cidr"], strict=False)
            parsed.append({
                "net": net,
                "name": n.get("name", str(net)),
                "vlan": n.get("vlan"),
                "usage": n.get("usage", ""),
            })
        except (ValueError, KeyError) as e:
            return {"error": f"Invalid network entry: {e}"}

    parsed.sort(key=lambda x: (x["net"].prefixlen, x["net"].network_address))

    lines = ["graph TD"]
    node_ids: Dict[str, str] = {}

    for i, entry in enumerate(parsed):
        node_id = f"net{i}"
        net = entry["net"]
        label = entry["name"]
        if entry["vlan"]:
            label += f"\\nVLAN {entry['vlan']}"
        label += f"\\n{net}"
        if net.version == 4:
            label += f"\\n{net.num_addresses - 2} hosts"
        node_ids[str(net)] = node_id
        lines.append(f'    {node_id}["{label}"]')

    for i, child in enumerate(parsed):
        for j, parent in enumerate(parsed):
            if i == j:
                continue
            if child["net"].subnet_of(parent["net"]) and child["net"] != parent["net"]:
                is_direct = True
                for k, mid in enumerate(parsed):
                    if k in (i, j):
                        continue
                    if (child["net"].subnet_of(mid["net"])
                            and mid["net"].subnet_of(parent["net"])
                            and mid["net"] != parent["net"]
                            and mid["net"] != child["net"]):
                        is_direct = False
                        break
                if is_direct:
                    p_id = node_ids[str(parent["net"])]
                    c_id = node_ids[str(child["net"])]
                    lines.append(f"    {p_id} --> {c_id}")

    diagram = "\n".join(lines)

    return {
        "format": "mermaid",
        "diagram": diagram,
        "network_count": len(parsed),
        "rendering_hint": "Paste into any Mermaid-compatible renderer (GitHub, Notion, mkdocs, etc.)",
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _subnet_info(net: ipaddress.IPv4Network | ipaddress.IPv6Network) -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "cidr": str(net),
        "network": str(net.network_address),
        "prefix": net.prefixlen,
        "num_addresses": net.num_addresses,
    }
    if net.version == 4:
        info.update({
            "netmask": str(net.netmask),
            "wildcard_mask": str(net.hostmask),
            "broadcast": str(net.broadcast_address),
            "first_host": str(net.network_address + 1) if net.num_addresses > 2 else "N/A",
            "last_host": str(net.broadcast_address - 1) if net.num_addresses > 2 else "N/A",
            "usable_hosts": max(net.num_addresses - 2, 0),
            "cisco_acl": f"{net.network_address} {net.hostmask}",
        })
    return info


def _generate_mermaid(
    devices: List[Dict[str, Any]],
    connections: List[Dict[str, Any]],
) -> Dict[str, Any]:
    icon_map = {
        "router": "{{%s}}",
        "switch": "[%s]",
        "firewall": "[/%s\\]",
        "server": "[(%s)]",
        "cloud": "((%s))",
        "host": ">%s]",
    }

    lines = ["graph TD"]
    node_ids: Dict[str, str] = {}

    for i, dev in enumerate(devices):
        name = dev.get("name", f"device{i}")
        dev_type = dev.get("type", "switch").lower()
        ip = dev.get("ip", "")
        node_id = re.sub(r"[^a-zA-Z0-9]", "_", name)
        node_ids[name] = node_id

        label = name
        if ip:
            label += f"\\n{ip}"

        fmt = icon_map.get(dev_type, "[%s]")
        lines.append(f"    {node_id}{fmt % label}")

    for conn in connections:
        src = node_ids.get(conn.get("from", ""))
        dst = node_ids.get(conn.get("to", ""))
        if not src or not dst:
            continue

        label = conn.get("label", "")
        if label:
            lines.append(f'    {src} -->|"{label}"| {dst}')
        else:
            lines.append(f"    {src} --> {dst}")

    diagram = "\n".join(lines)
    return {
        "format": "mermaid",
        "diagram": diagram,
        "device_count": len(devices),
        "connection_count": len(connections),
        "rendering_hint": "Paste into any Mermaid-compatible renderer (GitHub, Notion, mkdocs, etc.)",
    }


def _generate_ascii(
    devices: List[Dict[str, Any]],
    connections: List[Dict[str, Any]],
) -> Dict[str, Any]:
    lines = []
    lines.append("=" * 60)
    lines.append("  NETWORK TOPOLOGY")
    lines.append("=" * 60)
    lines.append("")

    lines.append("DEVICES:")
    lines.append("-" * 40)
    for dev in devices:
        name = dev.get("name", "unknown")
        dev_type = dev.get("type", "unknown")
        ip = dev.get("ip", "")
        entry = f"  [{dev_type.upper():>10}] {name}"
        if ip:
            entry += f" ({ip})"
        lines.append(entry)

    lines.append("")
    lines.append("CONNECTIONS:")
    lines.append("-" * 40)
    for conn in connections:
        src = conn.get("from", "?")
        dst = conn.get("to", "?")
        label = conn.get("label", "")
        entry = f"  {src} <---> {dst}"
        if label:
            entry += f"  [{label}]"
        lines.append(entry)

    lines.append("")
    lines.append("=" * 60)

    return {
        "format": "ascii",
        "diagram": "\n".join(lines),
        "device_count": len(devices),
        "connection_count": len(connections),
    }
