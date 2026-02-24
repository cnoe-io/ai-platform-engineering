# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
terraform_fmt Tool - Terraform HCL formatter.

Formats a Terraform/HCL file in the in-memory filesystem using `terraform fmt`
and writes the formatted result back to state.
"""

import os
import subprocess
import tempfile
from datetime import datetime, timezone
from typing import Annotated

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.prebuilt import InjectedState
from langgraph.types import Command


TF_FMT_TIMEOUT = 30


@tool
def terraform_fmt(
    file_path: str,
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command | str:
    """
    Format a Terraform/HCL file in-place using terraform fmt.

    Reads the file from the in-memory filesystem, formats it with terraform fmt,
    and writes the formatted content back.

    Args:
        file_path: Absolute path to the .tf file in the in-memory filesystem.
    """
    files = dict(state.get("files") or {})
    raw = files.get(file_path)

    if raw is None:
        return f"ERROR: File '{file_path}' not found in filesystem"

    content = "\n".join(raw["content"])

    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".tf")
        with os.fdopen(fd, "w") as f:
            f.write(content)

        result = subprocess.run(
            ["terraform", "fmt", "-no-color", tmp_path],
            capture_output=True,
            text=True,
            timeout=TF_FMT_TIMEOUT,
        )

        if result.returncode != 0:
            error = result.stderr.strip() if result.stderr else "Unknown error"
            return (
                f"ERROR: terraform fmt failed for {file_path}:\n{error}\n\n"
            )

        with open(tmp_path) as f:
            formatted = f.read()

        now = datetime.now(timezone.utc).isoformat()
        files[file_path] = {
            "content": formatted.splitlines(),
            "created_at": raw.get("created_at", now),
            "modified_at": now,
        }

        return Command(update={
            "files": files,
            "messages": [ToolMessage(
                content=f"Formatted {file_path} with terraform fmt ({len(formatted)} chars)",
                tool_call_id=tool_call_id,
            )],
        })

    except subprocess.TimeoutExpired:
        return f"ERROR: terraform fmt timed out after {TF_FMT_TIMEOUT}s"
    except FileNotFoundError:
        return "ERROR: terraform command not found - ensure terraform is installed"
    except Exception as e:
        return f"ERROR: {e}"
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


__all__ = ["terraform_fmt"]
