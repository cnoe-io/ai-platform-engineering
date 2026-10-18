# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Shared SSH execution helper for infra-ops tools.

All remote calls run over a single SSH identity (read-only host operations
only in this phase) and only ever invoke a fixed, allowlisted set of remote
commands - never arbitrary/user-supplied shell strings.
"""

import asyncio
import logging
import os
import shlex
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

INFRA_OPS_SSH_HOST = os.getenv("INFRA_OPS_SSH_HOST", "")
INFRA_OPS_SSH_USER = os.getenv("INFRA_OPS_SSH_USER", "")
INFRA_OPS_SSH_KEY_PATH = os.getenv("INFRA_OPS_SSH_KEY_PATH", "")
INFRA_OPS_SSH_PORT = os.getenv("INFRA_OPS_SSH_PORT", "22")
SSH_TIMEOUT = int(os.getenv("INFRA_OPS_SSH_TIMEOUT", "20"))
# A bare `podman` call addresses the *invoking SSH user's own* (rootless)
# storage, not the host's real rootful containers - on a host where the
# workload runs under rootful podman, that silently returns an empty
# container universe instead of an error. Set this to the rootful API
# socket (e.g. unix:///run/podman/podman.sock) when the SSH user is a
# non-root member of the group that socket is shared with.
INFRA_OPS_CONTAINER_HOST = os.getenv("INFRA_OPS_CONTAINER_HOST", "")


class InfraOpsConfigError(RuntimeError):
    """Raised when required SSH connection settings are missing."""


def _require_config() -> None:
    missing = [
        name
        for name, value in (
            ("INFRA_OPS_SSH_HOST", INFRA_OPS_SSH_HOST),
            ("INFRA_OPS_SSH_USER", INFRA_OPS_SSH_USER),
            ("INFRA_OPS_SSH_KEY_PATH", INFRA_OPS_SSH_KEY_PATH),
        )
        if not value
    ]
    if missing:
        raise InfraOpsConfigError(
            f"infra-ops SSH is not configured, missing env vars: {', '.join(missing)}"
        )


async def run_remote_command(argv: List[str]) -> Dict[str, Any]:
    """
    Run a single fixed remote command over SSH and return its result.

    Args:
        argv: The remote command as an argument list (e.g. ["podman", "ps", "-a"]).
            Never build this from unsanitized user input - callers must only
            pass fixed, allowlisted command shapes.

    Returns:
        Dict with stdout, stderr, exit_code, and success flag.
    """
    _require_config()

    remote_cmd = " ".join(shlex.quote(arg) for arg in argv)
    if INFRA_OPS_CONTAINER_HOST and argv and argv[0] == "podman":
        remote_cmd = f"CONTAINER_HOST={shlex.quote(INFRA_OPS_CONTAINER_HOST)} {remote_cmd}"
    ssh_cmd = [
        "ssh",
        "-i", INFRA_OPS_SSH_KEY_PATH,
        "-p", INFRA_OPS_SSH_PORT,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new",
        f"{INFRA_OPS_SSH_USER}@{INFRA_OPS_SSH_HOST}",
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
    except InfraOpsConfigError:
        raise
    except Exception as e:
        logger.error(f"infra-ops SSH command failed: {e}")
        return {"command": remote_cmd, "error": str(e), "success": False}
