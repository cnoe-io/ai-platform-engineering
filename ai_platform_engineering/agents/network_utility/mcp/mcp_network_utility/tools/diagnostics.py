# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Network diagnostic tools: ping, traceroute, port check, whois, interfaces, curl."""

import asyncio
import logging
import os
import re
import socket
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

HOSTNAME_REGEX = re.compile(r"^[a-zA-Z0-9._-]+$")
IP_REGEX = re.compile(r"^[0-9a-fA-F.:]+$")
MAX_PING_COUNT = int(os.getenv("MAX_PING_COUNT", "10"))
MAX_TRACEROUTE_HOPS = int(os.getenv("MAX_TRACEROUTE_HOPS", "30"))
CURL_TIMEOUT = int(os.getenv("CURL_TIMEOUT", "15"))
ALLOWED_CURL_SCHEMES = {"http", "https"}


def _validate_target(target: str) -> str:
    """Validate a hostname or IP address target."""
    target = target.strip()
    if not target or len(target) > 253:
        raise ValueError(f"Invalid target length: {len(target)}")
    if not HOSTNAME_REGEX.match(target) and not IP_REGEX.match(target):
        raise ValueError(f"Invalid target: {target}")
    return target


async def ping_host(
    target: str,
    count: int = 4,
    timeout: int = 5,
) -> Dict[str, Any]:
    """
    Ping a host to check connectivity and measure latency.

    Args:
        target: Hostname or IP address to ping (e.g., 'google.com' or '8.8.8.8').
        count: Number of ping packets to send. Defaults to 4, max 10.
        timeout: Timeout in seconds per packet. Defaults to 5.

    Returns:
        Dict with ping results including packet loss and latency statistics.
    """
    target = _validate_target(target)
    count = min(max(1, count), MAX_PING_COUNT)
    timeout = min(max(1, timeout), 30)

    cmd = ["ping", "-c", str(count), "-W", str(timeout), target]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=count * timeout + 5)

        return {
            "target": target,
            "count": count,
            "output": stdout.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode,
            "reachable": proc.returncode == 0,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"target": target, "error": "Ping timed out", "reachable": False}
    except Exception as e:
        logger.error(f"Ping failed: {e}")
        return {"target": target, "error": str(e), "reachable": False}


async def traceroute(
    target: str,
    max_hops: int = 30,
) -> Dict[str, Any]:
    """
    Trace the network route to a target host.

    Args:
        target: Hostname or IP address to trace (e.g., 'google.com').
        max_hops: Maximum number of hops. Defaults to 30.

    Returns:
        Dict with the traceroute output showing each hop along the path.
    """
    target = _validate_target(target)
    max_hops = min(max(1, max_hops), MAX_TRACEROUTE_HOPS)

    cmd = ["traceroute", "-m", str(max_hops), "-w", "3", target]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=max_hops * 5)

        return {
            "target": target,
            "max_hops": max_hops,
            "output": stdout.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"target": target, "error": "Traceroute timed out"}
    except FileNotFoundError:
        return {"error": "traceroute command not found. Ensure traceroute is installed."}
    except Exception as e:
        logger.error(f"Traceroute failed: {e}")
        return {"target": target, "error": str(e)}


async def check_port(
    target: str,
    port: int,
    timeout: int = 5,
) -> Dict[str, Any]:
    """
    Check if a specific TCP port is open on a target host.

    Args:
        target: Hostname or IP address to check.
        port: TCP port number to check (1-65535).
        timeout: Connection timeout in seconds. Defaults to 5.

    Returns:
        Dict indicating whether the port is open, closed, or filtered.
    """
    target = _validate_target(target)
    if not 1 <= port <= 65535:
        return {"error": f"Invalid port number: {port}. Must be 1-65535."}
    timeout = min(max(1, timeout), 30)

    try:
        loop = asyncio.get_event_loop()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: sock.connect_ex((target, port))),
            timeout=timeout + 1,
        )
        sock.close()

        return {
            "target": target,
            "port": port,
            "open": result == 0,
            "status": "open" if result == 0 else "closed/filtered",
        }
    except asyncio.TimeoutError:
        return {"target": target, "port": port, "open": False, "status": "filtered (timeout)"}
    except socket.gaierror:
        return {"target": target, "port": port, "error": f"Could not resolve hostname: {target}"}
    except Exception as e:
        logger.error(f"Port check failed: {e}")
        return {"target": target, "port": port, "error": str(e)}


async def whois_lookup(
    target: str,
) -> Dict[str, Any]:
    """
    Perform a WHOIS lookup for a domain or IP address.

    Args:
        target: Domain name or IP address to look up (e.g., 'example.com').

    Returns:
        Dict with WHOIS registration information.
    """
    target = _validate_target(target)

    try:
        proc = await asyncio.create_subprocess_exec(
            "whois", target,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        output = stdout.decode("utf-8", errors="replace")
        if len(output) > 10000:
            output = output[:10000] + "\n... (truncated)"

        return {
            "target": target,
            "output": output,
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"target": target, "error": "WHOIS lookup timed out"}
    except FileNotFoundError:
        return {"error": "whois command not found. Ensure whois is installed."}
    except Exception as e:
        logger.error(f"WHOIS lookup failed: {e}")
        return {"target": target, "error": str(e)}


async def get_network_interfaces() -> Dict[str, Any]:
    """
    List all network interfaces and their IP addresses on the current host.

    Returns:
        Dict with network interface information including IP addresses, MAC addresses, and status.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ip", "-j", "addr", "show",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)

        if proc.returncode == 0:
            import json
            try:
                interfaces = json.loads(stdout.decode("utf-8", errors="replace"))
                return {"interfaces": interfaces}
            except json.JSONDecodeError:
                return {"output": stdout.decode("utf-8", errors="replace")}

        # Fallback to ifconfig
        proc = await asyncio.create_subprocess_exec(
            "ifconfig",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        return {
            "output": stdout.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode,
        }
    except FileNotFoundError:
        return {"error": "Neither 'ip' nor 'ifconfig' command found."}
    except Exception as e:
        logger.error(f"Failed to get network interfaces: {e}")
        return {"error": str(e)}


async def curl_request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    include_headers: bool = False,
) -> Dict[str, Any]:
    """
    Make an HTTP request to a URL using curl.

    Useful for testing API endpoints, checking HTTP responses, and debugging connectivity.

    Args:
        url: The URL to request. Only http:// and https:// schemes are allowed.
        method: HTTP method (GET, HEAD, OPTIONS). Defaults to GET.
            POST/PUT/DELETE are not supported for safety.
        headers: Optional dict of HTTP headers to include.
        include_headers: Whether to include response headers in output. Defaults to False.

    Returns:
        Dict with HTTP response status, headers (if requested), and body.
    """
    url = url.strip()
    if not url:
        return {"error": "URL is required"}

    scheme = url.split("://")[0].lower() if "://" in url else ""
    if scheme not in ALLOWED_CURL_SCHEMES:
        return {"error": f"Only http:// and https:// URLs are allowed. Got: {scheme}://"}

    method = method.upper()
    if method not in {"GET", "HEAD", "OPTIONS"}:
        return {"error": f"Only GET, HEAD, and OPTIONS methods are allowed. Got: {method}"}

    cmd = [
        "curl", "-sS", "--max-time", str(CURL_TIMEOUT),
        "--max-filesize", "1048576",
        "-X", method,
    ]
    if include_headers:
        cmd.append("-i")

    if headers:
        for key, value in headers.items():
            key_s = re.sub(r"[^a-zA-Z0-9_-]", "", str(key))
            cmd.extend(["-H", f"{key_s}: {value}"])

    cmd.append(url)

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=CURL_TIMEOUT + 5)
        output = stdout.decode("utf-8", errors="replace")
        if len(output) > 50000:
            output = output[:50000] + "\n... (truncated)"

        return {
            "url": url,
            "method": method,
            "output": output,
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"url": url, "error": "Request timed out"}
    except FileNotFoundError:
        return {"error": "curl command not found."}
    except Exception as e:
        logger.error(f"Curl request failed: {e}")
        return {"url": url, "error": str(e)}
