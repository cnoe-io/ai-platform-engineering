# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
yq Tool - YAML processor.

Provides a single `yq` tool that can run any yq command.
Useful for parsing YAML files (Kubernetes manifests, Helm values, etc.).
Available to all agents (argocd, github, jira, etc.).
"""

import shlex
import subprocess

from langchain_core.tools import tool


YQ_TIMEOUT = 60  # 1 minute default


@tool
def yq(
    command: str,
    timeout: int = YQ_TIMEOUT,
) -> str:
    """
    Execute any yq command for YAML processing.

    Args:
        command: yq command to run (e.g., "yq '.metadata.name' deployment.yaml")
        timeout: Command timeout in seconds (default: 60)

    Returns:
        Processed YAML/JSON output as string. On error, returns "ERROR: <message>"

    Examples:
        yq("yq '.' values.yaml")
        yq("yq '.spec.replicas' deployment.yaml")
        yq("yq -o=json '.' config.yaml")
        yq("yq '.items[].metadata.name' resources.yaml")

    Common Options:
        -o, --output-format   Output format: yaml, json, props, csv, tsv
        -i, --inplace         Edit file in place
        -P, --prettyPrint     Pretty print output
        -r, --unwrapScalar    Unwrap scalar values (no quotes)
        -e, --exit-status     Exit with error if no matches
    """
    try:
        # Handle piped commands differently
        if '|' in command and not command.strip().startswith('yq'):
            # This is a shell pipeline like "cat file.yaml | yq ..."
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
        else:
            args = shlex.split(command)
            # Ensure command starts with 'yq'
            if not args or args[0] != 'yq':
                args = ['yq'] + args

            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=timeout
            )

        output = result.stdout.strip()

        if result.returncode != 0:
            error = result.stderr.strip() if result.stderr else "Unknown error"
            return f"ERROR: {error}"

        return output if output else "(empty result)"

    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return "ERROR: yq command not found - ensure yq is installed"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['yq']
