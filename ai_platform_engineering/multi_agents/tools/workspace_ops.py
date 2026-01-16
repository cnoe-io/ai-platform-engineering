# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Workspace - Temporary Filesystem for Agent Coordination

This tool provides a temporary workspace for agents to coordinate outputs
when multiple agents run in parallel. It solves the "garbled output" problem by allowing
agents to write to separate files and combine results cleanly.

SECURITY:
- Uses Python's tempfile.TemporaryDirectory (tmpfs on Linux)
- Completely isolated storage per context (thread_id/session_id)
- Thread-safe with locking mechanism
- Automatically cleaned up after task completion
- Restricted to temporary directory only

CONTEXT ISOLATION:
- Each thread_id/context_id gets its own isolated workspace
- No collisions between concurrent users or parallel requests
- Workspaces are automatically created on first use

USE CASE:
- Parallel agents write to separate files (e.g., "argocd_results.txt", "jira_results.txt")
- Supervisor combines outputs in organized manner
- Present clean, structured final response to user
"""

import logging
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Dict, Any, Optional
from langchain_core.tools import tool

# Set up logger
logger = logging.getLogger(__name__)

# Context-isolated workspaces (one per thread_id/session_id)
# Key: context_id (thread_id, session_id, or "default")
# Value: Dict with 'path' (str) and 'tempdir' (TemporaryDirectory object)
_workspaces: Dict[str, Dict[str, Any]] = {}
_workspace_lock = threading.Lock()

# Limits for safety
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB max per file
MAX_FILES = 100                   # Max 100 files in workspace
MAX_PATH_LENGTH = 256             # Reasonable path length
MAX_WORKSPACES = 1000             # Max number of concurrent workspaces


def _get_workspace(context_id: Optional[str] = None) -> str:
    """
    Get or create workspace for given context.

    Args:
        context_id: Context identifier (thread_id, session_id, etc.)
                   If None, uses "default" context

    Returns:
        Path to temporary directory for this context
    """
    if context_id is None:
        context_id = "default"

    with _workspace_lock:
        if context_id not in _workspaces:
            # Check workspace limit
            if len(_workspaces) >= MAX_WORKSPACES:
                logger.warning(f"Max workspaces ({MAX_WORKSPACES}) reached. Consider cleanup.")
                # Could implement LRU eviction here if needed

            tempdir = tempfile.TemporaryDirectory(prefix=f"agent_workspace_{context_id}_")
            _workspaces[context_id] = {
                'path': tempdir.name,
                'tempdir': tempdir
            }
            logger.info(f"Created new workspace for context: {context_id} at {tempdir.name}")

        return _workspaces[context_id]['path']


def _delete_workspace(context_id: Optional[str] = None) -> bool:
    """
    Delete workspace for given context.

    Args:
        context_id: Context identifier

    Returns:
        True if workspace was deleted, False if it didn't exist
    """
    if context_id is None:
        context_id = "default"

    with _workspace_lock:
        if context_id in _workspaces:
            workspace = _workspaces[context_id]
            # Cleanup is automatic when tempdir is deleted
            workspace['tempdir'].cleanup()
            del _workspaces[context_id]
            logger.info(f"Deleted workspace for context: {context_id}")
            return True
        return False


@tool
def write_workspace_file(file_path: str, content: str, context_id: Optional[str] = None) -> str:
    """
    Write content to a file in the temporary agent workspace.

    Args:
        file_path: Path to file (e.g., "argocd_results.md")
        content: Content to write to the file
        context_id: Optional context identifier for isolated workspaces

    Returns:
        Success message or "ERROR: <message>"

    Example:
        write_workspace_file("argocd_results.md", "## Applications\\n- app1")
    """
    try:
        workspace_root = _get_workspace(context_id)

        if len(file_path) > MAX_PATH_LENGTH:
            return f"ERROR: Path too long (max {MAX_PATH_LENGTH} characters)"

        file_path = file_path.lstrip('/')
        if '..' in file_path:
            return "ERROR: Path traversal not allowed"

        full_path = Path(workspace_root) / file_path

        all_files = list(Path(workspace_root).rglob('*'))
        file_count = sum(1 for f in all_files if f.is_file())
        if file_count >= MAX_FILES:
            return f"ERROR: Workspace full (max {MAX_FILES} files)"

        content_size = len(content.encode('utf-8'))
        if content_size > MAX_FILE_SIZE:
            return f"ERROR: Content too large ({content_size} bytes, max {MAX_FILE_SIZE})"

        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding='utf-8')

        ctx = context_id or "default"
        logger.info(f"Wrote workspace file [{ctx}]: {file_path} ({content_size} bytes)")
        return f"Wrote {content_size} bytes to {file_path}"

    except PermissionError as e:
        logger.error(f"Permission error writing {file_path}: {e}")
        return f"ERROR: Permission error: {e}"
    except OSError as e:
        logger.error(f"OS error writing {file_path}: {e}")
        return f"ERROR: OS error: {e}"
    except Exception as e:
        logger.error(f"Failed to write workspace file {file_path}: {e}")
        return f"ERROR: {e}"


@tool
def read_workspace_file(file_path: str, context_id: Optional[str] = None) -> str:
    """
    Read content from a file in the temporary agent workspace.

    Args:
        file_path: Path to file (e.g., "argocd_results.md")
        context_id: Optional context identifier for isolated workspaces

    Returns:
        File content as string, or "ERROR: <message>" on failure

    Example:
        content = read_workspace_file("argocd_results.md")
    """
    try:
        workspace_root = _get_workspace(context_id)

        file_path = file_path.lstrip('/')
        if '..' in file_path:
            return "ERROR: Path traversal not allowed"

        full_path = Path(workspace_root) / file_path

        if not full_path.exists():
            return f"ERROR: File not found: {file_path}"

        if not full_path.is_file():
            return f"ERROR: Path is not a file: {file_path}"

        content = full_path.read_text(encoding='utf-8')

        ctx = context_id or "default"
        logger.info(f"Read workspace file [{ctx}]: {file_path} ({len(content)} bytes)")
        return content

    except PermissionError as e:
        logger.error(f"Permission error reading {file_path}: {e}")
        return f"ERROR: Permission error: {e}"
    except OSError as e:
        logger.error(f"OS error reading {file_path}: {e}")
        return f"ERROR: OS error: {e}"
    except Exception as e:
        logger.error(f"Failed to read workspace file {file_path}: {e}")
        return f"ERROR: {e}"


@tool
def list_workspace_files(directory: str = "/", context_id: Optional[str] = None) -> str:
    """
    List files in the agent workspace.

    Args:
        directory: Directory to list (default: "/" for root)
        context_id: Optional context identifier for isolated workspaces

    Returns:
        Newline-separated list of files, or "ERROR: <message>" on failure

    Example:
        files = list_workspace_files()
    """
    try:
        workspace_root = _get_workspace(context_id)

        directory = directory.lstrip('/')
        if '..' in directory:
            return "ERROR: Path traversal not allowed"

        ctx = context_id or "default"

        if directory in ["", "/"]:
            workspace_path = Path(workspace_root)
            all_files = []
            for file_path in workspace_path.rglob('*'):
                if file_path.is_file():
                    rel_path = file_path.relative_to(workspace_path)
                    size = file_path.stat().st_size
                    all_files.append(f"{rel_path} ({size} bytes)")

            logger.info(f"Listed {len(all_files)} workspace files [{ctx}]")
            if not all_files:
                return "No files in workspace"
            return '\n'.join(all_files)
        else:
            full_dir_path = Path(workspace_root) / directory

            if not full_dir_path.exists():
                return f"ERROR: Directory not found: {directory}"

            if not full_dir_path.is_dir():
                return f"ERROR: Path is not a directory: {directory}"

            files = []
            for item in full_dir_path.iterdir():
                if item.is_file():
                    rel_path = item.relative_to(workspace_root)
                    size = item.stat().st_size
                    files.append(f"{rel_path} ({size} bytes)")

            logger.info(f"Listed {len(files)} workspace files in {directory} [{ctx}]")
            if not files:
                return f"No files in {directory}"
            return '\n'.join(files)

    except PermissionError as e:
        logger.error(f"Permission error listing {directory}: {e}")
        return f"ERROR: Permission error: {e}"
    except OSError as e:
        logger.error(f"OS error listing {directory}: {e}")
        return f"ERROR: OS error: {e}"
    except Exception as e:
        logger.error(f"Failed to list workspace files: {e}")
        return f"ERROR: {e}"


@tool
def clear_workspace(context_id: Optional[str] = None, delete_workspace: bool = False) -> str:
    """
    Clear all files from the agent workspace.

    Args:
        context_id: Optional context identifier for isolated workspaces
        delete_workspace: If True, deletes entire workspace instance

    Returns:
        Success message or "ERROR: <message>"

    Example:
        clear_workspace()
    """
    try:
        ctx = context_id or "default"

        if delete_workspace:
            deleted = _delete_workspace(context_id)
            if deleted:
                logger.info(f"Deleted workspace [{ctx}]")
                return f"Deleted workspace for context: {ctx}"
            else:
                return f"ERROR: Workspace not found for context: {ctx}"
        else:
            workspace_root = _get_workspace(context_id)
            workspace_path = Path(workspace_root)

            all_files = list(workspace_path.rglob('*'))
            file_count = sum(1 for f in all_files if f.is_file())

            for item in workspace_path.iterdir():
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)

            logger.info(f"Cleared workspace [{ctx}]: {file_count} files removed")
            return f"Cleared {file_count} files from workspace"

    except PermissionError as e:
        logger.error(f"Permission error clearing workspace: {e}")
        return f"ERROR: Permission error: {e}"
    except OSError as e:
        logger.error(f"OS error clearing workspace: {e}")
        return f"ERROR: OS error: {e}"
    except Exception as e:
        logger.error(f"Failed to clear workspace: {e}")
        return f"ERROR: {e}"


# Export tools
__all__ = [
    'write_workspace_file',
    'read_workspace_file',
    'list_workspace_files',
    'clear_workspace'
]

