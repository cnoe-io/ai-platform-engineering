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
import os
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional
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
def write_workspace_file(file_path: str, content: str, context_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Write content to a file in the temporary agent workspace.

    Use this when multiple agents are working in parallel and you need to store
    intermediate results to prevent garbled output. Each agent can write to its
    own file, then the results can be combined cleanly.

    Args:
        file_path: Path to file (e.g., "argocd_results.md", "analysis/jira_issues.txt")
                  Directory separators (/) are allowed for organization
        content: Content to write to the file
        context_id: Optional context identifier (thread_id, session_id, etc.)
                   Each context gets its own isolated workspace to prevent collisions
                   If None, uses "default" context

    Returns:
        Dict with success status, file info, and message

    Example:
        # ArgoCD agent writes its results
        write_workspace_file("argocd_results.md", "## Applications\\n\\n- app1\\n- app2")

        # Jira agent writes its results
        write_workspace_file("jira_results.md", "## Issues\\n\\n- PROJ-123\\n- PROJ-456")

        # Later, combine the files for final response
        argocd = read_workspace_file("argocd_results.md")
        jira = read_workspace_file("jira_results.md")
        combined = argocd['content'] + "\\n\\n" + jira['content']

    Notes:
        - Files are stored in tmpfs (temporary filesystem)
        - Each context_id gets isolated workspace (no collisions)
        - Workspace is temporary and cleared between tasks
        - Maximum file size: 5 MB
        - Maximum 100 files per workspace
    """
    try:
        # Get workspace for this context
        workspace_root = _get_workspace(context_id)

        # Validate path length
        if len(file_path) > MAX_PATH_LENGTH:
            return {
                'success': False,
                'path': file_path,
                'message': f'Path too long (max {MAX_PATH_LENGTH} characters)'
            }

        # Sanitize file path (remove leading slashes, prevent path traversal)
        file_path = file_path.lstrip('/')
        if '..' in file_path:
            return {
                'success': False,
                'path': file_path,
                'message': 'Path traversal not allowed'
            }

        full_path = Path(workspace_root) / file_path

        # Check file count limit
        all_files = list(Path(workspace_root).rglob('*'))
        file_count = sum(1 for f in all_files if f.is_file())
        if file_count >= MAX_FILES:
            return {
                'success': False,
                'path': file_path,
                'message': f'Workspace full (max {MAX_FILES} files)'
            }

        # Check content size
        content_size = len(content.encode('utf-8'))
        if content_size > MAX_FILE_SIZE:
            return {
                'success': False,
                'path': file_path,
                'size': content_size,
                'message': f'Content too large ({content_size} bytes, max {MAX_FILE_SIZE})'
            }

        # Create parent directories if needed
        full_path.parent.mkdir(parents=True, exist_ok=True)

        # Write the file
        full_path.write_text(content, encoding='utf-8')

        ctx = context_id or "default"
        logger.info(f"Wrote workspace file [{ctx}]: {file_path} ({content_size} bytes)")
        return {
            'success': True,
            'path': file_path,
            'size': content_size,
            'context_id': ctx,
            'message': f'Successfully wrote {content_size} characters to {file_path}'
        }

    except PermissionError as e:
        logger.error(f"Permission error writing {file_path}: {e}")
        return {
            'success': False,
            'path': file_path,
            'message': f'Permission error: {str(e)}'
        }
    except OSError as e:
        logger.error(f"OS error writing {file_path}: {e}")
        return {
            'success': False,
            'path': file_path,
            'message': f'OS error: {str(e)}'
        }
    except Exception as e:
        logger.error(f"Failed to write workspace file {file_path}: {e}")
        return {
            'success': False,
            'path': file_path,
            'message': f'Error: {str(e)}'
        }


@tool
def read_workspace_file(file_path: str, context_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Read content from a file in the temporary agent workspace.

    Use this to retrieve results written by parallel agents. Common pattern:
    agents write to separate files, supervisor reads and combines them.

    Args:
        file_path: Path to file (e.g., "argocd_results.md")
        context_id: Optional context identifier (thread_id, session_id, etc.)
                   Must match the context_id used when writing
                   If None, uses "default" context

    Returns:
        Dict with success status, content, and metadata

    Example:
        # Read results from ArgoCD agent
        result = read_workspace_file("argocd_results.md")
        if result['success']:
            print(result['content'])

    Notes:
        - Files are in tmpfs (temporary filesystem)
        - Each context_id has isolated workspace
        - Returns error if file doesn't exist
    """
    try:
        # Get workspace for this context
        workspace_root = _get_workspace(context_id)

        # Sanitize file path
        file_path = file_path.lstrip('/')
        if '..' in file_path:
            return {
                'success': False,
                'content': None,
                'path': file_path,
                'message': 'Path traversal not allowed'
            }

        full_path = Path(workspace_root) / file_path

        # Check if file exists
        if not full_path.exists():
            return {
                'success': False,
                'content': None,
                'path': file_path,
                'message': f'File not found: {file_path}'
            }

        # Check if it's a file (not directory)
        if not full_path.is_file():
            return {
                'success': False,
                'content': None,
                'path': file_path,
                'message': f'Path is not a file: {file_path}'
            }

        # Read the file
        content = full_path.read_text(encoding='utf-8')
        size = len(content)

        ctx = context_id or "default"
        logger.info(f"Read workspace file [{ctx}]: {file_path} ({size} bytes)")
        return {
            'success': True,
            'content': content,
            'path': file_path,
            'size': size,
            'context_id': ctx,
            'message': f'Successfully read {size} characters from {file_path}'
        }

    except PermissionError as e:
        logger.error(f"Permission error reading {file_path}: {e}")
        return {
            'success': False,
            'content': None,
            'path': file_path,
            'message': f'Permission error: {str(e)}'
        }
    except OSError as e:
        logger.error(f"OS error reading {file_path}: {e}")
        return {
            'success': False,
            'content': None,
            'path': file_path,
            'message': f'OS error: {str(e)}'
        }
    except Exception as e:
        logger.error(f"Failed to read workspace file {file_path}: {e}")
        return {
            'success': False,
            'content': None,
            'path': file_path,
            'message': f'Error: {str(e)}'
        }


@tool
def list_workspace_files(directory: str = "/", context_id: Optional[str] = None) -> Dict[str, Any]:
    """
    List files in the agent workspace.

    Use this to see what files agents have created, useful for debugging
    or discovering available results to combine.

    Args:
        directory: Directory to list (default: "/" for root)
        context_id: Optional context identifier (thread_id, session_id, etc.)
                   Must match the context_id used when writing
                   If None, uses "default" context

    Returns:
        Dict with file list and metadata

    Example:
        # List all workspace files
        result = list_workspace_files()
        print("Available files:", result['files'])

        # List files in specific directory
        result = list_workspace_files("analysis")

    Notes:
        - Shows all files across all directories if directory="/"
        - Each context_id has isolated workspace
        - Returns file sizes for reference
    """
    try:
        # Get workspace for this context
        workspace_root = _get_workspace(context_id)

        # Sanitize directory path
        directory = directory.lstrip('/')
        if '..' in directory:
            return {
                'success': False,
                'files': [],
                'count': 0,
                'message': 'Path traversal not allowed'
            }

        ctx = context_id or "default"

        if directory in ["", "/"]:
            # List all files recursively
            workspace_path = Path(workspace_root)
            all_files = []
            for file_path in workspace_path.rglob('*'):
                if file_path.is_file():
                    rel_path = file_path.relative_to(workspace_path)
                    all_files.append({
                        'path': str(rel_path),
                        'size': file_path.stat().st_size
                    })

            logger.info(f"Listed {len(all_files)} workspace files [{ctx}]")
            return {
                'success': True,
                'files': all_files,
                'count': len(all_files),
                'context_id': ctx,
                'message': f'Found {len(all_files)} files in workspace'
            }
        else:
            # List specific directory
            full_dir_path = Path(workspace_root) / directory

            if not full_dir_path.exists():
                return {
                    'success': False,
                    'files': [],
                    'count': 0,
                    'message': f'Directory not found: {directory}'
                }

            if not full_dir_path.is_dir():
                return {
                    'success': False,
                    'files': [],
                    'count': 0,
                    'message': f'Path is not a directory: {directory}'
                }

            files = []
            for item in full_dir_path.iterdir():
                if item.is_file():
                    rel_path = item.relative_to(workspace_root)
                    files.append({
                        'path': str(rel_path),
                        'size': item.stat().st_size
                    })

            logger.info(f"Listed {len(files)} workspace files in {directory} [{ctx}]")
            return {
                'success': True,
                'files': files,
                'count': len(files),
                'context_id': ctx,
                'message': f'Found {len(files)} files in {directory}'
            }

    except PermissionError as e:
        logger.error(f"Permission error listing {directory}: {e}")
        return {
            'success': False,
            'files': [],
            'count': 0,
            'message': f'Permission error: {str(e)}'
        }
    except OSError as e:
        logger.error(f"OS error listing {directory}: {e}")
        return {
            'success': False,
            'files': [],
            'count': 0,
            'message': f'OS error: {str(e)}'
        }
    except Exception as e:
        logger.error(f"Failed to list workspace files: {e}")
        return {
            'success': False,
            'files': [],
            'count': 0,
            'message': f'Error: {str(e)}'
        }


@tool
def clear_workspace(context_id: Optional[str] = None, delete_workspace: bool = False) -> Dict[str, Any]:
    """
    Clear all files from the agent workspace.

    Use this at the start of a new task to ensure clean slate, or at the end
    to clean up. The workspace is automatically cleared between sessions.

    Args:
        context_id: Optional context identifier (thread_id, session_id, etc.)
                   Must match the context_id used when writing
                   If None, uses "default" context
        delete_workspace: If True, deletes entire workspace instance (frees memory)
                         If False (default), just clears files but keeps workspace

    Returns:
        Dict with success status and count of files cleared

    Example:
        # Clear workspace at start of new task
        clear_workspace()

        # Clear specific context
        clear_workspace(context_id="thread_123")

        # Delete entire workspace (frees memory)
        clear_workspace(context_id="thread_123", delete_workspace=True)

        # Now agents can write fresh results
        write_workspace_file("argocd_results.md", data)

    Notes:
        - Removes all files from temporary workspace
        - Each context_id has isolated workspace
        - Cannot be undone
        - Safe operation (restricted to temp directory)
    """
    try:
        ctx = context_id or "default"

        if delete_workspace:
            # Delete entire workspace instance
            deleted = _delete_workspace(context_id)
            if deleted:
                logger.info(f"Deleted workspace [{ctx}]")
                return {
                    'success': True,
                    'files_removed': 0,  # Unknown count
                    'workspace_deleted': True,
                    'context_id': ctx,
                    'message': f'Deleted entire workspace for context: {ctx}'
                }
            else:
                return {
                    'success': False,
                    'files_removed': 0,
                    'workspace_deleted': False,
                    'context_id': ctx,
                    'message': f'Workspace not found for context: {ctx}'
                }
        else:
            # Just clear files, keep workspace instance
            workspace_root = _get_workspace(context_id)
            workspace_path = Path(workspace_root)

            # Count existing files
            all_files = list(workspace_path.rglob('*'))
            file_count = sum(1 for f in all_files if f.is_file())

            # Remove all files and directories
            for item in workspace_path.iterdir():
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)

            logger.info(f"Cleared workspace [{ctx}]: {file_count} files removed")
            return {
                'success': True,
                'files_removed': file_count,
                'workspace_deleted': False,
                'context_id': ctx,
                'message': f'Cleared workspace ({file_count} files removed)'
            }

    except PermissionError as e:
        logger.error(f"Permission error clearing workspace: {e}")
        return {
            'success': False,
            'files_removed': 0,
            'workspace_deleted': False,
            'message': f'Permission error: {str(e)}'
        }
    except OSError as e:
        logger.error(f"OS error clearing workspace: {e}")
        return {
            'success': False,
            'files_removed': 0,
            'workspace_deleted': False,
            'message': f'OS error: {str(e)}'
        }
    except Exception as e:
        logger.error(f"Failed to clear workspace: {e}")
        return {
            'success': False,
            'files_removed': 0,
            'workspace_deleted': False,
            'message': f'Error: {str(e)}'
        }


# Export tools
__all__ = [
    'write_workspace_file',
    'read_workspace_file',
    'list_workspace_files',
    'clear_workspace'
]

