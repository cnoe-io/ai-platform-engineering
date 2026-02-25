# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""DHCP lease management and dnsmasq log parsing tools."""

import logging
import os
import re
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

DNSMASQ_LEASE_FILE = os.getenv("DNSMASQ_LEASE_FILE", "/var/lib/misc/dnsmasq.leases")
DNSMASQ_LOG_DIR = os.getenv("DNSMASQ_LOG_DIR", "/mnt/logs")
MAC_REGEX = re.compile(r"^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$")


async def list_dhcp_leases() -> Dict[str, Any]:
    """
    List all active DHCP leases from the dnsmasq lease file.

    Reads the dnsmasq lease file and returns structured lease data including
    expiry time, MAC address, IP address, hostname, and client ID.

    Returns:
        Dict with a list of active DHCP leases.
    """
    try:
        lease_path = Path(DNSMASQ_LEASE_FILE)
        if not lease_path.exists():
            return {"error": f"Lease file not found: {DNSMASQ_LEASE_FILE}", "leases": []}

        content = lease_path.read_text(encoding="utf-8")
        leases: List[Dict[str, str]] = []

        for line in content.strip().splitlines():
            parts = line.split()
            if len(parts) >= 4:
                lease = {
                    "expiry_epoch": parts[0],
                    "mac_address": parts[1],
                    "ip_address": parts[2],
                    "hostname": parts[3] if parts[3] != "*" else "(unknown)",
                }
                if len(parts) >= 5:
                    lease["client_id"] = parts[4]
                leases.append(lease)

        return {
            "lease_file": DNSMASQ_LEASE_FILE,
            "total_leases": len(leases),
            "leases": leases,
        }
    except Exception as e:
        logger.error(f"Failed to read DHCP leases: {e}")
        return {"error": str(e), "leases": []}


async def get_dhcp_lease_by_mac(
    mac_address: str,
) -> Dict[str, Any]:
    """
    Find a specific DHCP lease by MAC address.

    Args:
        mac_address: The MAC address to search for (e.g., '00:11:22:33:44:55').

    Returns:
        Dict with the matching lease information, or indication that no lease was found.
    """
    mac_address = mac_address.strip().lower()
    if not MAC_REGEX.match(mac_address):
        return {"error": f"Invalid MAC address format: {mac_address}. Expected: XX:XX:XX:XX:XX:XX"}

    result = await list_dhcp_leases()
    if "error" in result and not result.get("leases"):
        return result

    matching = [
        lease for lease in result.get("leases", [])
        if lease.get("mac_address", "").lower() == mac_address
    ]

    return {
        "mac_address": mac_address,
        "found": len(matching) > 0,
        "leases": matching,
    }


async def get_dnsmasq_logs(
    tail_lines: int = 100,
) -> Dict[str, Any]:
    """
    Read the dnsmasq log file for DHCP/DNS/BOOTP/PXE activity.

    All dnsmasq activity (DHCP, DNS, BOOTP, PXE) is logged to a single file.

    Args:
        tail_lines: Number of lines to return from the end of the log. Defaults to 100, max 500.

    Returns:
        Dict with the log file contents (last N lines).
    """
    tail_lines = min(max(1, tail_lines), 500)

    log_file = Path(DNSMASQ_LOG_DIR) / "dnsmasq.log"
    if not log_file.exists():
        return {
            "error": f"Log file not found: {log_file}",
        }

    resolved = log_file.resolve()
    allowed_dir = Path(DNSMASQ_LOG_DIR).resolve()
    if not str(resolved).startswith(str(allowed_dir)):
        return {"error": "Path traversal detected"}

    try:
        content = log_file.read_text(encoding="utf-8", errors="replace")
        lines = content.strip().splitlines()
        tail = lines[-tail_lines:] if len(lines) > tail_lines else lines

        return {
            "log_file": str(log_file),
            "total_lines": len(lines),
            "returned_lines": len(tail),
            "content": "\n".join(tail),
        }
    except Exception as e:
        logger.error(f"Failed to read dnsmasq log: {e}")
        return {"error": str(e)}
