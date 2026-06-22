# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Cisco-centric network tools: SNMP, CDP/LLDP, config parsing, subnet calc, ACL analysis."""

import asyncio
import ipaddress
import json
import logging
import os
import re
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

HOSTNAME_REGEX = re.compile(r"^[a-zA-Z0-9._-]+$")
IP_REGEX = re.compile(r"^[0-9a-fA-F.:]+$")
SNMP_TIMEOUT = int(os.getenv("SNMP_TIMEOUT", "10"))
SNMP_RETRIES = int(os.getenv("SNMP_RETRIES", "2"))


def _validate_target(target: str) -> str:
    target = target.strip()
    if not target or len(target) > 253:
        raise ValueError(f"Invalid target length: {len(target)}")
    if not HOSTNAME_REGEX.match(target) and not IP_REGEX.match(target):
        raise ValueError(f"Invalid target: {target}")
    return target


# ---------------------------------------------------------------------------
# SNMP
# ---------------------------------------------------------------------------

async def snmp_get(
    target: str,
    oid: str,
    community: str = "public",
    version: str = "2c",
) -> Dict[str, Any]:
    """
    Perform an SNMP GET request against a network device.

    Retrieves a single OID value. Common Cisco OIDs:
    - sysDescr: 1.3.6.1.2.1.1.1.0 (device description / IOS version)
    - sysName: 1.3.6.1.2.1.1.5.0 (hostname)
    - sysUpTime: 1.3.6.1.2.1.1.3.0 (uptime)
    - ifNumber: 1.3.6.1.2.1.2.1.0 (interface count)

    Args:
        target: Hostname or IP of the SNMP-enabled device.
        oid: SNMP OID to query (e.g., '1.3.6.1.2.1.1.1.0' for sysDescr).
        community: SNMP community string. Defaults to 'public'.
        version: SNMP version - '1', '2c', or '3'. Defaults to '2c'.

    Returns:
        Dict with OID, type, and value from the device.
    """
    target = _validate_target(target)
    oid = oid.strip()
    if not re.match(r"^[0-9.]+$", oid):
        return {"error": f"Invalid OID format: {oid}"}
    if version not in {"1", "2c", "3"}:
        return {"error": f"Unsupported SNMP version: {version}. Use '1', '2c', or '3'."}

    cmd = [
        "snmpget", f"-v{version}", "-c", community,
        "-t", str(SNMP_TIMEOUT), "-r", str(SNMP_RETRIES),
        target, oid,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=SNMP_TIMEOUT * (SNMP_RETRIES + 1) + 5
        )
        output = stdout.decode("utf-8", errors="replace")

        return {
            "target": target,
            "oid": oid,
            "version": version,
            "output": output,
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"target": target, "oid": oid, "error": "SNMP GET timed out"}
    except FileNotFoundError:
        return {"error": "snmpget command not found. Ensure snmp package is installed."}
    except Exception as e:
        logger.error(f"SNMP GET failed: {e}")
        return {"target": target, "error": str(e)}


async def snmp_walk(
    target: str,
    oid: str,
    community: str = "public",
    version: str = "2c",
    max_results: int = 100,
) -> Dict[str, Any]:
    """
    Perform an SNMP WALK (bulk retrieval) against a network device.

    Walks an OID subtree to retrieve multiple values. Common Cisco subtrees:
    - ifDescr: 1.3.6.1.2.1.2.2.1.2 (interface descriptions)
    - ifOperStatus: 1.3.6.1.2.1.2.2.1.8 (interface up/down status)
    - ifInOctets: 1.3.6.1.2.1.2.2.1.10 (interface input bytes)
    - ifOutOctets: 1.3.6.1.2.1.2.2.1.16 (interface output bytes)
    - ipRouteTable: 1.3.6.1.2.1.4.21 (IP routing table)
    - cdpCacheDeviceId: 1.3.6.1.4.1.9.9.23.1.2.1.1.6 (CDP neighbor devices)

    Args:
        target: Hostname or IP of the SNMP-enabled device.
        oid: Root OID to walk (e.g., '1.3.6.1.2.1.2.2.1.2' for ifDescr).
        community: SNMP community string. Defaults to 'public'.
        version: SNMP version - '1', '2c'. Defaults to '2c'.
        max_results: Maximum number of OID results to return. Defaults to 100.

    Returns:
        Dict with all OID/value pairs found under the specified subtree.
    """
    target = _validate_target(target)
    oid = oid.strip()
    if not re.match(r"^[0-9.]+$", oid):
        return {"error": f"Invalid OID format: {oid}"}

    max_results = min(max(1, max_results), 500)

    cmd = [
        "snmpwalk", f"-v{version}", "-c", community,
        "-t", str(SNMP_TIMEOUT), "-r", str(SNMP_RETRIES),
        target, oid,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=SNMP_TIMEOUT * (SNMP_RETRIES + 1) + 30
        )
        output = stdout.decode("utf-8", errors="replace")
        lines = output.strip().split("\n")
        if len(lines) > max_results:
            lines = lines[:max_results]
            output = "\n".join(lines) + f"\n... (truncated to {max_results} results)"

        return {
            "target": target,
            "oid": oid,
            "version": version,
            "result_count": min(len(lines), max_results),
            "output": output if lines != [""] else "(empty)",
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"target": target, "oid": oid, "error": "SNMP WALK timed out"}
    except FileNotFoundError:
        return {"error": "snmpwalk command not found. Ensure snmp package is installed."}
    except Exception as e:
        logger.error(f"SNMP WALK failed: {e}")
        return {"target": target, "error": str(e)}


# ---------------------------------------------------------------------------
# CDP / LLDP Neighbor Discovery
# ---------------------------------------------------------------------------

async def lldp_neighbors() -> Dict[str, Any]:
    """
    Show LLDP (Link Layer Discovery Protocol) neighbors.

    LLDP is the vendor-neutral alternative to Cisco CDP. It discovers directly
    connected network devices and their capabilities. Works with Cisco, Arista,
    Juniper, and other vendors.

    Returns:
        Dict with discovered neighbors including device ID, port, and capabilities.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "lldpcli", "show", "neighbors", "-f", "json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        output = stdout.decode("utf-8", errors="replace")

        try:
            data = json.loads(output)
            return {"neighbors": data}
        except json.JSONDecodeError:
            return {"output": output, "exit_code": proc.returncode}
    except FileNotFoundError:
        return {
            "error": "lldpcli not found. LLDP daemon (lldpd) is not installed or running.",
            "note": "On Cisco IOS devices, use 'show lldp neighbors' via SSH/SNMP instead.",
        }
    except Exception as e:
        logger.error(f"LLDP neighbors failed: {e}")
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Subnet / IP Calculator
# ---------------------------------------------------------------------------

async def subnet_calculator(
    network: str,
) -> Dict[str, Any]:
    """
    Calculate subnet details for a given CIDR network.

    Provides network address, broadcast address, usable host range, netmask,
    wildcard mask (Cisco ACL format), and host count. Supports both IPv4 and IPv6.

    Useful for verifying Cisco ACL wildcard masks and subnet configurations.

    Args:
        network: CIDR notation network (e.g., '10.0.0.0/24' or '192.168.1.128/26').

    Returns:
        Dict with full subnet breakdown including Cisco-style wildcard mask.
    """
    try:
        net = ipaddress.ip_network(network, strict=False)

        result: Dict[str, Any] = {
            "network": str(net.network_address),
            "prefix_length": net.prefixlen,
            "version": f"IPv{net.version}",
            "num_addresses": net.num_addresses,
        }

        if net.version == 4:
            result.update({
                "netmask": str(net.netmask),
                "wildcard_mask": str(net.hostmask),
                "broadcast": str(net.broadcast_address),
                "first_host": str(net.network_address + 1) if net.num_addresses > 2 else "N/A",
                "last_host": str(net.broadcast_address - 1) if net.num_addresses > 2 else "N/A",
                "usable_hosts": max(net.num_addresses - 2, 0),
                "cisco_acl_format": f"{net.network_address} {net.hostmask}",
                "is_private": net.is_private,
            })
        else:
            result.update({
                "netmask": str(net.netmask),
                "first_host": str(net.network_address + 1),
                "last_host": str(net.broadcast_address),
                "is_private": net.is_private,
            })

        return result
    except ValueError as e:
        return {"error": f"Invalid network: {e}"}


async def subnet_contains_ip(
    network: str,
    ip_address: str,
) -> Dict[str, Any]:
    """
    Check if an IP address belongs to a specific subnet.

    Useful for verifying ACL rules and routing decisions on Cisco devices.

    Args:
        network: CIDR notation network (e.g., '10.0.0.0/8').
        ip_address: IP address to check (e.g., '10.1.2.3').

    Returns:
        Dict with whether the IP is contained in the subnet.
    """
    try:
        net = ipaddress.ip_network(network, strict=False)
        addr = ipaddress.ip_address(ip_address.strip())
        return {
            "network": str(net),
            "ip_address": str(addr),
            "contained": addr in net,
            "cisco_acl_format": f"{net.network_address} {net.hostmask}" if net.version == 4 else str(net),
        }
    except ValueError as e:
        return {"error": f"Invalid input: {e}"}


# ---------------------------------------------------------------------------
# Cisco IOS Config Parser
# ---------------------------------------------------------------------------

async def parse_cisco_config(
    config_text: str,
    section: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Parse a Cisco IOS/NX-OS configuration and extract structured sections.

    Extracts interfaces, ACLs, routing, VLANs, and other configuration blocks
    from raw Cisco configuration text. Can filter for a specific section.

    Args:
        config_text: Raw Cisco configuration text (show running-config output).
        section: Optional section to extract (e.g., 'interfaces', 'acls',
            'routing', 'vlans', 'ntp', 'logging', 'snmp', 'aaa').
            If not specified, returns all parsed sections.

    Returns:
        Dict with parsed configuration sections organized by type.
    """
    if not config_text or not config_text.strip():
        return {"error": "No configuration text provided"}

    if len(config_text) > 500000:
        return {"error": "Config too large (max 500KB)"}

    lines = config_text.split("\n")
    parsed: Dict[str, Any] = {
        "hostname": None,
        "interfaces": [],
        "acls": [],
        "route_maps": [],
        "static_routes": [],
        "vlans": [],
        "ntp_servers": [],
        "logging_hosts": [],
        "snmp_communities": [],
        "aaa_config": [],
        "banner": None,
    }

    current_block: List[str] = []
    current_type = None

    for line in lines:
        stripped = line.rstrip()

        if stripped.startswith("hostname "):
            parsed["hostname"] = stripped.split("hostname ", 1)[1].strip()
            continue

        if stripped.startswith("ip route ") or stripped.startswith("ipv6 route "):
            parsed["static_routes"].append(stripped)
            continue

        if stripped.startswith("ntp server "):
            parsed["ntp_servers"].append(stripped.split("ntp server ", 1)[1].strip())
            continue

        if stripped.startswith("logging host ") or stripped.startswith("logging "):
            if "host" in stripped:
                parsed["logging_hosts"].append(stripped)
            continue

        if stripped.startswith("snmp-server community "):
            parts = stripped.split()
            if len(parts) >= 3:
                parsed["snmp_communities"].append({
                    "community": parts[2],
                    "access": parts[3] if len(parts) > 3 else "unknown",
                    "full_line": stripped,
                })
            continue

        if stripped.startswith("aaa "):
            parsed["aaa_config"].append(stripped)
            continue

        if stripped.startswith("interface "):
            if current_block and current_type:
                _save_block(parsed, current_type, current_block)
            current_type = "interfaces"
            current_block = [stripped]
            continue

        if re.match(r"^(ip )?access-list ", stripped):
            if current_block and current_type:
                _save_block(parsed, current_type, current_block)
            current_type = "acls"
            current_block = [stripped]
            continue

        if stripped.startswith("route-map "):
            if current_block and current_type:
                _save_block(parsed, current_type, current_block)
            current_type = "route_maps"
            current_block = [stripped]
            continue

        if stripped.startswith("vlan ") and not stripped.startswith("vlan internal"):
            if current_block and current_type:
                _save_block(parsed, current_type, current_block)
            current_type = "vlans"
            current_block = [stripped]
            continue

        if stripped.startswith("!") or stripped == "":
            if current_block and current_type:
                _save_block(parsed, current_type, current_block)
            current_type = None
            current_block = []
            continue

        if current_type and (stripped.startswith(" ") or stripped.startswith("\t")):
            current_block.append(stripped)

    if current_block and current_type:
        _save_block(parsed, current_type, current_block)

    if section:
        section = section.lower().strip()
        if section in parsed:
            return {"section": section, "data": parsed[section], "hostname": parsed["hostname"]}
        return {"error": f"Unknown section: {section}. Available: {list(parsed.keys())}"}

    return parsed


def _save_block(parsed: Dict, block_type: str, block_lines: List[str]) -> None:
    """Save a parsed configuration block."""
    block_text = "\n".join(block_lines)
    if block_type in parsed and isinstance(parsed[block_type], list):
        parsed[block_type].append(block_text)


async def analyze_cisco_acl(
    acl_text: str,
) -> Dict[str, Any]:
    """
    Analyze a Cisco ACL (Access Control List) and provide a structured breakdown.

    Parses standard and extended ACLs, identifies permit/deny rules, extracts
    source/destination networks with wildcard masks, and checks for common issues.

    Args:
        acl_text: Raw ACL configuration text from 'show access-list' or running-config.

    Returns:
        Dict with parsed ACL entries, statistics (permit/deny counts), and warnings.
    """
    if not acl_text or not acl_text.strip():
        return {"error": "No ACL text provided"}

    lines = acl_text.strip().split("\n")
    entries: List[Dict[str, Any]] = []
    warnings: List[str] = []
    permit_count = 0
    deny_count = 0
    acl_name = None

    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("!"):
            continue

        if re.match(r"^(ip )?access-list ", stripped):
            acl_name = stripped
            continue

        action_match = re.search(r"\b(permit|deny)\b", stripped, re.IGNORECASE)
        if action_match:
            action = action_match.group(1).lower()
            if action == "permit":
                permit_count += 1
            else:
                deny_count += 1

            entry: Dict[str, Any] = {
                "line": line_num,
                "action": action,
                "rule": stripped,
            }

            if "any" in stripped.lower() and action == "permit":
                warnings.append(
                    f"Line {line_num}: 'permit any' is overly permissive"
                )
            if "0.0.0.0 255.255.255.255" in stripped:
                warnings.append(
                    f"Line {line_num}: wildcard 255.255.255.255 matches all hosts (equivalent to 'any')"
                )
            if "log" in stripped.lower():
                entry["logging"] = True

            entries.append(entry)

    if entries and entries[-1]["action"] != "deny":
        warnings.append(
            "Implicit deny at end of ACL - last explicit rule is not a deny. "
            "Cisco ACLs have an implicit 'deny all' at the end."
        )

    return {
        "acl_name": acl_name,
        "total_entries": len(entries),
        "permit_count": permit_count,
        "deny_count": deny_count,
        "entries": entries,
        "warnings": warnings if warnings else None,
    }
