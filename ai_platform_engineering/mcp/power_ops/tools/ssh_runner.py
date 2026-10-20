# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Shared SSH execution helper for the VPS-backed components this server
switches on/off. Same connection model as infra_ops/tools/ssh_runner.py
(not imported from there - each MCP server stays independently deployable)
- fixed allowlisted remote commands only, never arbitrary/user-supplied
shell strings.

Two SSH targets, not one: the components this server manages are split
across two separate rootless podman namespaces on the VPS (caipeadmin owns
the caipe-core stack; root owns the KCG/Gemma/Korch stack) and a rootless
podman user cannot see another user's containers. Each target has its own
forced-command-restricted key - see the two wrapper scripts this server's
README documents - so a component's registry entry (tools/registry.py)
names which target it needs via ssh_target.
"""

import asyncio
import logging
import os
import shlex
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

POWER_OPS_SSH_HOST = os.getenv("POWER_OPS_SSH_HOST", "")
POWER_OPS_SSH_PORT = os.getenv("POWER_OPS_SSH_PORT", "22")
SSH_TIMEOUT = int(os.getenv("POWER_OPS_SSH_TIMEOUT", "20"))

# Valid ssh_target values in tools/registry.py. Each resolves to its own
# user/key env vars - POWER_OPS_<TARGET>_SSH_USER / _SSH_KEY_PATH - so the
# two namespaces can be configured, rotated, and revoked independently.
KNOWN_TARGETS = frozenset({"caipeadmin", "root"})


class PowerOpsConfigError(RuntimeError):
    """Raised when required SSH connection settings are missing."""


def _require_config(target: str) -> Dict[str, str]:
    if target not in KNOWN_TARGETS:
        raise PowerOpsConfigError(f"Unknown SSH target: {target!r}")

    user = os.getenv(f"POWER_OPS_{target.upper()}_SSH_USER", "")
    key_path = os.getenv(f"POWER_OPS_{target.upper()}_SSH_KEY_PATH", "")

    missing = [
        name
        for name, value in (
            ("POWER_OPS_SSH_HOST", POWER_OPS_SSH_HOST),
            (f"POWER_OPS_{target.upper()}_SSH_USER", user),
            (f"POWER_OPS_{target.upper()}_SSH_KEY_PATH", key_path),
        )
        if not value
    ]
    if missing:
        raise PowerOpsConfigError(
            f"power-ops SSH target {target!r} is not configured, "
            f"missing env vars: {', '.join(missing)}"
        )
    return {"user": user, "key_path": key_path}


async def run_remote_command(target: str, argv: List[str]) -> Dict[str, Any]:
    """
    Run a single fixed remote command over SSH against the named target and
    return its result.

    Args:
        target: One of KNOWN_TARGETS - which forced-command-restricted
            account to connect as (see tools/registry.py's ssh_target).
        argv: The remote command as an argument list (e.g. ["podman", "stop", "kcg-backend"]).
            Never build this from unsanitized user input - callers must only
            pass fixed, allowlisted command shapes.

    Returns:
        Dict with stdout, stderr, exit_code, and success flag.
    """
    creds = _require_config(target)

    remote_cmd = " ".join(shlex.quote(arg) for arg in argv)
    ssh_cmd = [
        "ssh",
        "-i", creds["key_path"],
        "-p", POWER_OPS_SSH_PORT,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new",
        f"{creds['user']}@{POWER_OPS_SSH_HOST}",
        remote_cmd,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *ssh_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=SSH_TIMEOUT)
        return {
            "command": remote_cmd,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode,
            "success": proc.returncode == 0,
        }
    except asyncio.TimeoutError:
        return {"command": remote_cmd, "error": "SSH command timed out", "success": False}
    except PowerOpsConfigError:
        raise
    except Exception as e:
        logger.error(f"power-ops SSH command failed: {e}")
        return {"command": remote_cmd, "error": str(e), "success": False}
