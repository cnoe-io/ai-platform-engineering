# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Advanced networking tools: mtr, nmap, arp, routes, ss, SSL/TLS, MTU, bandwidth."""

import asyncio
import json
import logging
import os
import re
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

HOSTNAME_REGEX = re.compile(r"^[a-zA-Z0-9._-]+$")
IP_REGEX = re.compile(r"^[0-9a-fA-F.:]+$")
MAX_MTR_COUNT = int(os.getenv("MAX_MTR_COUNT", "10"))
NMAP_TIMEOUT = int(os.getenv("NMAP_TIMEOUT", "60"))


def _validate_target(target: str) -> str:
    target = target.strip()
    if not target or len(target) > 253:
        raise ValueError(f"Invalid target length: {len(target)}")
    if not HOSTNAME_REGEX.match(target) and not IP_REGEX.match(target):
        raise ValueError(f"Invalid target: {target}")
    return target


async def mtr_report(
    target: str,
    count: int = 5,
    use_tcp: bool = False,
    port: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Run an MTR (My Traceroute) report combining ping and traceroute functionality.

    MTR provides continuous traceroute with packet loss and latency statistics per hop,
    making it superior to plain traceroute for diagnosing intermittent network issues.

    Args:
        target: Hostname or IP address (e.g., 'cisco.com').
        count: Number of probes per hop. Defaults to 5, max 10.
        use_tcp: Use TCP SYN instead of ICMP. Useful for targets behind firewalls.
        port: TCP port to probe when use_tcp is True. Defaults to 80.

    Returns:
        Dict with per-hop loss%, latency stats (avg/best/worst), and AS numbers.
    """
    target = _validate_target(target)
    count = min(max(1, count), MAX_MTR_COUNT)

    cmd = ["mtr", "--report", "--report-cycles", str(count), "--json", target]
    if use_tcp:
        cmd.append("--tcp")
        if port and 1 <= port <= 65535:
            cmd.extend(["--port", str(port)])

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=count * 30 + 30
        )

        output = stdout.decode("utf-8", errors="replace")
        try:
            data = json.loads(output)
            return {"target": target, "count": count, "report": data, "exit_code": proc.returncode}
        except json.JSONDecodeError:
            return {"target": target, "output": output, "exit_code": proc.returncode}
    except asyncio.TimeoutError:
        return {"target": target, "error": "MTR report timed out"}
    except FileNotFoundError:
        return {"error": "mtr command not found. Ensure mtr is installed."}
    except Exception as e:
        logger.error(f"MTR report failed: {e}")
        return {"target": target, "error": str(e)}


async def nmap_port_scan(
    target: str,
    ports: str = "22,23,80,443,8080,8443",
    scan_type: str = "connect",
) -> Dict[str, Any]:
    """
    Scan TCP ports on a target host using nmap.

    Useful for verifying firewall rules, checking service availability,
    and validating ACL configurations on network devices.

    Args:
        target: Hostname or IP address to scan.
        ports: Comma-separated port list or range (e.g., '22,80,443' or '1-1024').
            Defaults to common service ports.
        scan_type: Scan type - 'connect' (TCP connect, no root) or 'syn' (SYN scan, needs root).
            Defaults to 'connect'.

    Returns:
        Dict with open/closed/filtered status for each port and service detection.
    """
    target = _validate_target(target)
    if not re.match(r"^[0-9,\- ]+$", ports):
        return {"error": f"Invalid port specification: {ports}"}

    scan_flag = "-sT" if scan_type != "syn" else "-sS"
    cmd = ["nmap", scan_flag, "-p", ports, "--open", "-oX", "-", target]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=NMAP_TIMEOUT
        )
        output = stdout.decode("utf-8", errors="replace")
        if len(output) > 50000:
            output = output[:50000] + "\n... (truncated)"

        return {
            "target": target,
            "ports": ports,
            "scan_type": scan_type,
            "output": output,
            "exit_code": proc.returncode,
            "error": stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
        }
    except asyncio.TimeoutError:
        return {"target": target, "error": "Nmap scan timed out"}
    except FileNotFoundError:
        return {"error": "nmap command not found. Ensure nmap is installed."}
    except Exception as e:
        logger.error(f"Nmap scan failed: {e}")
        return {"target": target, "error": str(e)}


async def show_arp_table() -> Dict[str, Any]:
    """
    Display the ARP (Address Resolution Protocol) table.

    Shows IP-to-MAC address mappings for hosts on the local network segment.
    Useful for verifying Layer 2 connectivity and detecting IP conflicts.

    Returns:
        Dict with ARP entries including IP address, MAC address, and interface.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ip", "-j", "neigh", "show",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        output = stdout.decode("utf-8", errors="replace")

        try:
            entries = json.loads(output)
            return {"entries": entries}
        except json.JSONDecodeError:
            return {"output": output}
    except FileNotFoundError:
        try:
            proc = await asyncio.create_subprocess_exec(
                "arp", "-a",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            return {"output": stdout.decode("utf-8", errors="replace")}
        except FileNotFoundError:
            return {"error": "Neither 'ip' nor 'arp' command found."}
    except Exception as e:
        logger.error(f"ARP table failed: {e}")
        return {"error": str(e)}


async def show_routing_table() -> Dict[str, Any]:
    """
    Display the IP routing table.

    Shows all routes including default gateway, static routes, and connected networks.
    Useful for verifying routing configuration and troubleshooting connectivity issues.

    Returns:
        Dict with routing entries including destination, gateway, interface, and metric.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ip", "-j", "route", "show",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        output = stdout.decode("utf-8", errors="replace")

        try:
            routes = json.loads(output)
            return {"routes": routes}
        except json.JSONDecodeError:
            return {"output": output}
    except FileNotFoundError:
        try:
            proc = await asyncio.create_subprocess_exec(
                "netstat", "-rn",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            return {"output": stdout.decode("utf-8", errors="replace")}
        except FileNotFoundError:
            return {"error": "Neither 'ip' nor 'netstat' command found."}
    except Exception as e:
        logger.error(f"Routing table failed: {e}")
        return {"error": str(e)}


async def show_socket_stats(
    state: Optional[str] = None,
    protocol: str = "tcp",
) -> Dict[str, Any]:
    """
    Display active network connections and listening sockets.

    Shows TCP/UDP socket statistics similar to netstat but with more detail.
    Useful for checking which services are listening and active connections.

    Args:
        state: Filter by socket state (e.g., 'listening', 'established', 'time-wait').
        protocol: Protocol filter - 'tcp', 'udp', or 'all'. Defaults to 'tcp'.

    Returns:
        Dict with socket information including local/remote addresses, state, and process.
    """
    cmd = ["ss", "-n"]
    if protocol == "tcp":
        cmd.append("-t")
    elif protocol == "udp":
        cmd.append("-u")
    else:
        cmd.extend(["-t", "-u"])

    if state:
        state_clean = re.sub(r"[^a-zA-Z-]", "", state)
        cmd.extend(["state", state_clean])
    else:
        cmd.append("-a")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        output = stdout.decode("utf-8", errors="replace")
        if len(output) > 50000:
            output = output[:50000] + "\n... (truncated)"

        return {
            "protocol": protocol,
            "state_filter": state,
            "output": output,
            "exit_code": proc.returncode,
        }
    except FileNotFoundError:
        return {"error": "ss command not found. Ensure iproute2 is installed."}
    except Exception as e:
        logger.error(f"Socket stats failed: {e}")
        return {"error": str(e)}


async def check_ssl_certificate(
    target: str,
    port: int = 443,
) -> Dict[str, Any]:
    """
    Check the SSL/TLS certificate of a remote host.

    Retrieves certificate details including issuer, subject, validity dates,
    SANs, and protocol/cipher information. Useful for verifying TLS
    configuration on Cisco devices, load balancers, and web services.

    Args:
        target: Hostname or IP to check (e.g., 'cisco.com').
        port: TLS port number. Defaults to 443.

    Returns:
        Dict with certificate details, expiry info, and TLS version/cipher.
    """
    target = _validate_target(target)
    if not 1 <= port <= 65535:
        return {"error": f"Invalid port: {port}"}

    cmd = [
        "openssl", "s_client",
        "-connect", f"{target}:{port}",
        "-servername", target,
        "-showcerts",
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=b"Q\n"), timeout=15
        )
        conn_output = stdout.decode("utf-8", errors="replace")

        cert_cmd = [
            "openssl", "s_client",
            "-connect", f"{target}:{port}",
            "-servername", target,
        ]
        proc2 = await asyncio.create_subprocess_exec(
            *cert_cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout2, _ = await asyncio.wait_for(
            proc2.communicate(input=b"Q\n"), timeout=15
        )
        raw_cert = stdout2.decode("utf-8", errors="replace")

        cert_text = ""
        begin = raw_cert.find("-----BEGIN CERTIFICATE-----")
        end = raw_cert.find("-----END CERTIFICATE-----")
        if begin != -1 and end != -1:
            pem = raw_cert[begin:end + len("-----END CERTIFICATE-----")]
            x509_proc = await asyncio.create_subprocess_exec(
                "openssl", "x509", "-text", "-noout",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            x509_out, _ = await asyncio.wait_for(
                x509_proc.communicate(input=pem.encode()), timeout=10
            )
            cert_text = x509_out.decode("utf-8", errors="replace")

        if len(conn_output) > 20000:
            conn_output = conn_output[:20000] + "\n... (truncated)"

        return {
            "target": target,
            "port": port,
            "certificate_details": cert_text,
            "connection_info": conn_output,
        }
    except asyncio.TimeoutError:
        return {"target": target, "error": "SSL check timed out"}
    except FileNotFoundError:
        return {"error": "openssl command not found."}
    except Exception as e:
        logger.error(f"SSL check failed: {e}")
        return {"target": target, "error": str(e)}


async def check_mtu(
    target: str,
    start_size: int = 1500,
) -> Dict[str, Any]:
    """
    Discover the Path MTU to a target by sending progressively smaller packets.

    Helps diagnose MTU-related issues like packet fragmentation, black holes,
    and GRE/VPN tunnel overhead on Cisco devices.

    Args:
        target: Hostname or IP address.
        start_size: Starting packet size in bytes. Defaults to 1500.

    Returns:
        Dict with the discovered Path MTU and test results.
    """
    target = _validate_target(target)
    start_size = min(max(68, start_size), 9000)

    results = []
    size = start_size

    while size >= 68:
        payload = size - 28
        cmd = ["ping", "-c", "1", "-W", "2", "-M", "do", "-s", str(payload), target]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            success = proc.returncode == 0
            results.append({"size": size, "success": success})

            if success:
                return {
                    "target": target,
                    "path_mtu": size,
                    "tests": results,
                }
            size -= 10
        except asyncio.TimeoutError:
            results.append({"size": size, "success": False, "note": "timeout"})
            size -= 10
        except Exception as e:
            return {"target": target, "error": str(e), "tests": results}

    return {
        "target": target,
        "path_mtu": 68,
        "note": "Minimum MTU reached",
        "tests": results,
    }
