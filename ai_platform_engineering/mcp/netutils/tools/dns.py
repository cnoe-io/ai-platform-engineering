# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""DNS lookup tools for network diagnostics."""

import asyncio
import logging
import re
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

ALLOWED_RECORD_TYPES = {"A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "PTR", "SRV", "CAA"}
HOSTNAME_REGEX = re.compile(r"^[a-zA-Z0-9._-]+$")
IP_REGEX = re.compile(r"^[0-9a-fA-F.:]+$")


def _validate_hostname(hostname: str) -> str:
    """Validate and sanitize hostname input."""
    hostname = hostname.strip()
    if not hostname or len(hostname) > 253:
        raise ValueError(f"Invalid hostname length: {len(hostname)}")
    if not HOSTNAME_REGEX.match(hostname):
        raise ValueError(f"Invalid hostname characters: {hostname}")
    return hostname


async def dns_lookup(
    hostname: str,
    record_type: str = "A",
    dns_server: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Perform a DNS lookup for a given hostname.

    Args:
        hostname: The hostname to resolve (e.g., 'example.com').
        record_type: DNS record type to query (A, AAAA, CNAME, MX, NS, TXT, SOA, PTR, SRV, CAA).
            Defaults to 'A'.
        dns_server: Optional DNS server to use for the query (e.g., '8.8.8.8').
            If not provided, uses system default.

    Returns:
        Dict with query details and DNS records found.
    """
    hostname = _validate_hostname(hostname)
    record_type = record_type.upper()
    if record_type not in ALLOWED_RECORD_TYPES:
        return {"error": f"Unsupported record type: {record_type}. Allowed: {sorted(ALLOWED_RECORD_TYPES)}"}

    cmd = ["dig", "+noall", "+answer", "+authority", "+stats", hostname, record_type]
    if dns_server:
        if not IP_REGEX.match(dns_server.strip()):
            return {"error": f"Invalid DNS server address: {dns_server}"}
        cmd.insert(1, f"@{dns_server.strip()}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        output = stdout.decode("utf-8", errors="replace")

        return {
            "hostname": hostname,
            "record_type": record_type,
            "dns_server": dns_server or "system default",
            "output": output,
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"error": f"DNS lookup timed out for {hostname}"}
    except FileNotFoundError:
        return {"error": "dig command not found. Ensure dnsutils/bind-tools is installed."}
    except Exception as e:
        logger.error(f"DNS lookup failed: {e}")
        return {"error": str(e)}


async def reverse_dns_lookup(
    ip_address: str,
    dns_server: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Perform a reverse DNS lookup for an IP address.

    Args:
        ip_address: The IP address to look up (e.g., '8.8.8.8').
        dns_server: Optional DNS server to use for the query.

    Returns:
        Dict with the reverse DNS result (PTR record).
    """
    ip_address = ip_address.strip()
    if not IP_REGEX.match(ip_address):
        return {"error": f"Invalid IP address: {ip_address}"}

    cmd = ["dig", "+noall", "+answer", "-x", ip_address]
    if dns_server:
        if not IP_REGEX.match(dns_server.strip()):
            return {"error": f"Invalid DNS server address: {dns_server}"}
        cmd.insert(1, f"@{dns_server.strip()}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        output = stdout.decode("utf-8", errors="replace")

        return {
            "ip_address": ip_address,
            "dns_server": dns_server or "system default",
            "output": output,
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"error": f"Reverse DNS lookup timed out for {ip_address}"}
    except FileNotFoundError:
        return {"error": "dig command not found. Ensure dnsutils/bind-tools is installed."}
    except Exception as e:
        logger.error(f"Reverse DNS lookup failed: {e}")
        return {"error": str(e)}


async def dns_lookup_all_records(
    hostname: str,
    dns_server: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Perform DNS lookups for all common record types for a hostname.

    Queries A, AAAA, CNAME, MX, NS, TXT, and SOA records in parallel.

    Args:
        hostname: The hostname to resolve (e.g., 'example.com').
        dns_server: Optional DNS server to use for the queries.

    Returns:
        Dict with results for each record type queried.
    """
    hostname = _validate_hostname(hostname)
    record_types = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA"]

    tasks = [dns_lookup(hostname, rt, dns_server) for rt in record_types]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    records: Dict[str, Any] = {}
    for rt, result in zip(record_types, results):
        if isinstance(result, Exception):
            records[rt] = {"error": str(result)}
        else:
            records[rt] = result

    return {
        "hostname": hostname,
        "dns_server": dns_server or "system default",
        "records": records,
    }
