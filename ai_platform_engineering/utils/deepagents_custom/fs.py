"""Thread-scoped in-memory filesystem for agent state persistence.

This module provides a thread-safe, session-scoped filesystem that allows
agents to persist files within a conversation context without affecting
other concurrent sessions.

Also provides LangChain tools for agents to read/write files.
"""

import threading
import json
from contextlib import contextmanager
from typing import Dict, Any, Optional, List

from langchain_core.tools import tool

# Thread-local storage for current thread ID
_thread_local = threading.local()

# Global lock for filesystem operations
FS_LOCK = threading.RLock()

# Global filesystem storage: {thread_id: {filename: content}}
FS: Dict[str, Dict[str, str]] = {}


def set_current_thread_id(thread_id: str) -> None:
    """Set the current thread ID for filesystem scoping.
    
    Args:
        thread_id: Unique identifier for the current session/thread
    """
    _thread_local.thread_id = thread_id


def get_current_thread_id() -> Optional[str]:
    """Get the current thread ID.
    
    Returns:
        The current thread ID, or None if not set
    """
    return getattr(_thread_local, 'thread_id', None)


def _get_thread_fs() -> Dict[str, str]:
    """Get the filesystem for the current thread.
    
    Returns:
        Dictionary of files for the current thread
    """
    thread_id = get_current_thread_id()
    if thread_id is None:
        thread_id = "default"
    
    with FS_LOCK:
        if thread_id not in FS:
            FS[thread_id] = {}
        return FS[thread_id]


def dump_filesystem() -> Dict[str, str]:
    """Dump the current thread's filesystem.
    
    Returns:
        Copy of the current thread's filesystem
    """
    with FS_LOCK:
        return dict(_get_thread_fs())


def load_filesystem(files: Dict[str, str]) -> None:
    """Load files into the current thread's filesystem.
    
    Args:
        files: Dictionary of filename -> content to load
    """
    thread_id = get_current_thread_id()
    if thread_id is None:
        thread_id = "default"
    
    with FS_LOCK:
        if thread_id not in FS:
            FS[thread_id] = {}
        FS[thread_id].update(files)


def clear_thread_files() -> None:
    """Clear all files for the current thread."""
    thread_id = get_current_thread_id()
    if thread_id is None:
        thread_id = "default"
    
    with FS_LOCK:
        if thread_id in FS:
            FS[thread_id] = {}


@contextmanager
def fs_context(thread_id: str):
    """Context manager for filesystem operations with a specific thread ID.
    
    Args:
        thread_id: The thread ID to use for this context
        
    Yields:
        The filesystem dictionary for this thread
    """
    old_thread_id = get_current_thread_id()
    try:
        set_current_thread_id(thread_id)
        yield _get_thread_fs()
    finally:
        if old_thread_id is not None:
            set_current_thread_id(old_thread_id)
