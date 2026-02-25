# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Dnsmasq configuration management tools."""

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

DNSMASQ_CONFIG_DIR = os.getenv("DNSMASQ_CONFIG_DIR", "/mnt/config")
ALLOWED_CONFIG_DIR = Path(DNSMASQ_CONFIG_DIR).resolve()


def _validate_config_path(filename: str) -> Path:
    """Validate that the config file path is within the allowed directory."""
    filename = filename.strip()
    if not filename:
        raise ValueError("Filename is required")
    if ".." in filename or filename.startswith("/"):
        raise ValueError("Path traversal is not allowed")
    if not re.match(r"^[a-zA-Z0-9._-]+$", filename):
        raise ValueError(f"Invalid filename characters: {filename}")
    resolved = (ALLOWED_CONFIG_DIR / filename).resolve()
    if not str(resolved).startswith(str(ALLOWED_CONFIG_DIR)):
        raise ValueError("Path traversal detected")
    return resolved


async def get_dnsmasq_config(
    filename: str = "",
) -> Dict[str, Any]:
    """
    Read a dnsmasq configuration file from the config directory.

    If no filename is provided, reads all .conf files from the config directory.

    Args:
        filename: Name of the config file to read (e.g., 'dhcp.conf').
            If empty, reads all .conf files in the config directory.

    Returns:
        Dict with the configuration file contents.
    """
    try:
        if filename:
            path = _validate_config_path(filename)
            if not path.exists():
                return {"error": f"Config file not found: {filename}"}
            content = path.read_text(encoding="utf-8")
            if len(content) > 100000:
                content = content[:100000] + "\n... (truncated)"
            return {"filename": filename, "content": content}

        config_dir = Path(DNSMASQ_CONFIG_DIR)
        if not config_dir.exists():
            return {"error": f"Config directory not found: {DNSMASQ_CONFIG_DIR}"}

        configs: Dict[str, str] = {}
        for conf_file in sorted(config_dir.glob("*.conf")):
            try:
                content = conf_file.read_text(encoding="utf-8")
                if len(content) > 50000:
                    content = content[:50000] + "\n... (truncated)"
                configs[conf_file.name] = content
            except Exception as e:
                configs[conf_file.name] = f"Error reading: {e}"

        return {
            "config_dir": DNSMASQ_CONFIG_DIR,
            "files": configs,
            "total_files": len(configs),
        }
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"Failed to read dnsmasq config: {e}")
        return {"error": str(e)}


async def validate_dnsmasq_config() -> Dict[str, Any]:
    """
    Validate the current dnsmasq configuration by running dnsmasq --test.

    Returns:
        Dict indicating whether the configuration is valid, with any error messages.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "dnsmasq", "--test", f"--conf-dir={DNSMASQ_CONFIG_DIR}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        output = stderr.decode("utf-8", errors="replace") + stdout.decode("utf-8", errors="replace")

        return {
            "valid": proc.returncode == 0,
            "output": output.strip(),
            "exit_code": proc.returncode,
        }
    except asyncio.TimeoutError:
        return {"error": "Config validation timed out"}
    except FileNotFoundError:
        return {"error": "dnsmasq command not found. Is dnsmasq installed?"}
    except Exception as e:
        logger.error(f"Config validation failed: {e}")
        return {"error": str(e)}


async def list_dnsmasq_config_files() -> Dict[str, Any]:
    """
    List all configuration files in the dnsmasq config directory.

    Returns:
        Dict with a list of config file names and their sizes.
    """
    try:
        config_dir = Path(DNSMASQ_CONFIG_DIR)
        if not config_dir.exists():
            return {"error": f"Config directory not found: {DNSMASQ_CONFIG_DIR}"}

        files: List[Dict[str, Any]] = []
        for path in sorted(config_dir.iterdir()):
            if path.is_file():
                stat = path.stat()
                files.append({
                    "name": path.name,
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                })

        return {
            "config_dir": DNSMASQ_CONFIG_DIR,
            "files": files,
            "total_files": len(files),
        }
    except Exception as e:
        logger.error(f"Failed to list config files: {e}")
        return {"error": str(e)}
