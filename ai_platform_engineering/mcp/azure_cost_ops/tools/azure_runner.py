# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Shared `az` CLI execution helper - identical contract to
azure_power_ops/tools/azure_runner.py (fixed argv, never an arbitrary
string; lazy service-principal login reused across calls in the same
process). Duplicated rather than imported across packages because each MCP
server here ships as an independent, independently-deployable unit (see
ai_platform_engineering/mcp/common for genuinely shared code).

Auth reuses the same service-principal env vars kendrainfra's own
Jenkinsfile already sets for Terraform (ARM_CLIENT_ID / ARM_CLIENT_SECRET /
ARM_TENANT_ID / ARM_SUBSCRIPTION_ID) - no new credential mechanism to
manage.
"""

import asyncio
import logging
import os
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

AZ_TIMEOUT = int(os.getenv("AZURE_COST_OPS_AZ_TIMEOUT", "120"))
REQUIRED_ENV = ("ARM_CLIENT_ID", "ARM_CLIENT_SECRET", "ARM_TENANT_ID", "ARM_SUBSCRIPTION_ID")

_logged_in = False
_login_lock = asyncio.Lock()


class AzureConfigError(RuntimeError):
    """Raised when required Azure service-principal env vars are missing, or az login fails."""


def _require_config() -> None:
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        raise AzureConfigError(
            f"Azure service principal is not configured, missing env vars: {', '.join(missing)}"
        )


async def _run(argv: List[str]) -> Dict[str, Any]:
    cmd_str = " ".join(argv)
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=AZ_TIMEOUT)
        return {
            "command": cmd_str,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode,
            "success": proc.returncode == 0,
        }
    except asyncio.TimeoutError:
        return {"command": cmd_str, "error": "az command timed out", "success": False}


async def _ensure_login() -> None:
    global _logged_in
    if _logged_in:
        return
    _require_config()
    async with _login_lock:
        if _logged_in:
            return
        login_result = await _run([
            "az", "login", "--service-principal",
            "-u", os.environ["ARM_CLIENT_ID"],
            "-p", os.environ["ARM_CLIENT_SECRET"],
            "--tenant", os.environ["ARM_TENANT_ID"],
            "--output", "none",
        ])
        if not login_result["success"]:
            raise AzureConfigError(f"az login --service-principal failed: {login_result.get('stderr', '')}")

        set_sub_result = await _run([
            "az", "account", "set", "--subscription", os.environ["ARM_SUBSCRIPTION_ID"],
        ])
        if not set_sub_result["success"]:
            raise AzureConfigError(f"az account set failed: {set_sub_result.get('stderr', '')}")

        _logged_in = True


async def run_az_command(argv: List[str]) -> Dict[str, Any]:
    """
    Run a single fixed `az` command (after ensuring login) and return its
    result.

    Args:
        argv: The az subcommand as an argument list, e.g.
            ["consumption", "usage", "list", "-s", start, "-e", end].
            Never built from unsanitized user input - callers only pass
            fixed, allowlisted command shapes.
    """
    await _ensure_login()
    try:
        return await _run(["az", "--output", "json"] + argv)
    except AzureConfigError:
        raise
    except Exception as e:
        logger.error(f"azure-cost-ops az command failed: {e}")
        return {"command": " ".join(argv), "error": str(e), "success": False}
