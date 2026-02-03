# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
File Tool - Read and write files to the filesystem.

Provides tools for file I/O operations:
- read_file: Read content from a file
- write_file: Write content to a file
- append_file: Append content to a file

Available to all agents (argocd, github, jira, etc.).
"""

from pathlib import Path

from langchain_core.tools import tool


# Safety limits
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB max read
MAX_WRITE_SIZE = 5 * 1024 * 1024  # 5 MB max write


@tool
def read_file(
    path: str,
    encoding: str = "utf-8",
) -> str:
    """
    Read content from a file.

    Args:
        path: Path to the file (absolute or relative)
        encoding: File encoding (default: utf-8)

    Returns:
        File content as string. On error, returns "ERROR: <message>"

    Examples:
        read_file("/tmp/data.json")
        read_file("./config.yaml")
        read_file("/path/to/cloned/repo/README.md")

    Notes:
        - Maximum file size: 10 MB
        - Binary files will fail with encoding errors
    """
    try:
        file_path = Path(path).expanduser().resolve()

        if not file_path.exists():
            return f"ERROR: File not found: {path}"

        if not file_path.is_file():
            return f"ERROR: Not a file: {path}"

        # Check file size
        file_size = file_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            return f"ERROR: File too large ({file_size} bytes, max {MAX_FILE_SIZE})"

        content = file_path.read_text(encoding=encoding)
        return content

    except UnicodeDecodeError as e:
        return f"ERROR: Encoding error (try binary file?): {e}"
    except PermissionError:
        return f"ERROR: Permission denied: {path}"
    except Exception as e:
        return f"ERROR: {e}"


@tool
def write_file(
    path: str,
    content: str,
    encoding: str = "utf-8",
    create_dirs: bool = True,
) -> str:
    """
    Write content to a file (overwrites existing).

    Args:
        path: Path to the file (absolute or relative)
        content: Content to write
        encoding: File encoding (default: utf-8)
        create_dirs: Create parent directories if missing (default: True)

    Returns:
        Success message or "ERROR: <message>"

    Examples:
        write_file("/tmp/output.json", '{"status": "ok"}')
        write_file("./results.md", "# Results\\n\\n- Item 1\\n- Item 2")
        write_file("/tmp/report/data.csv", "name,value\\ntest,123")

    Notes:
        - Maximum content size: 5 MB
        - Overwrites existing files
        - Creates parent directories by default
    """
    try:
        # Check content size
        content_size = len(content.encode(encoding))
        if content_size > MAX_WRITE_SIZE:
            return f"ERROR: Content too large ({content_size} bytes, max {MAX_WRITE_SIZE})"

        file_path = Path(path).expanduser().resolve()

        # Create parent directories if needed
        if create_dirs:
            file_path.parent.mkdir(parents=True, exist_ok=True)

        file_path.write_text(content, encoding=encoding)
        return f"Wrote {content_size} bytes to {path}"

    except PermissionError:
        return f"ERROR: Permission denied: {path}"
    except Exception as e:
        return f"ERROR: {e}"


@tool
def append_file(
    path: str,
    content: str,
    encoding: str = "utf-8",
    create_if_missing: bool = True,
) -> str:
    """
    Append content to a file.

    Args:
        path: Path to the file (absolute or relative)
        content: Content to append
        encoding: File encoding (default: utf-8)
        create_if_missing: Create file if it doesn't exist (default: True)

    Returns:
        Success message or "ERROR: <message>"

    Examples:
        append_file("/tmp/log.txt", "New log entry\\n")
        append_file("./results.csv", "row1,data1\\n")

    Notes:
        - Appends to end of file
        - Creates file if missing (by default)
    """
    try:
        file_path = Path(path).expanduser().resolve()

        if not file_path.exists():
            if create_if_missing:
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.touch()
            else:
                return f"ERROR: File not found: {path}"

        content_size = len(content.encode(encoding))

        with open(file_path, 'a', encoding=encoding) as f:
            f.write(content)

        return f"Appended {content_size} bytes to {path}"

    except PermissionError:
        return f"ERROR: Permission denied: {path}"
    except Exception as e:
        return f"ERROR: {e}"


@tool
def list_files(
    path: str = ".",
    pattern: str = "*",
    recursive: bool = False,
) -> str:
    """
    List files in a directory.

    Args:
        path: Directory path (default: current directory)
        pattern: Glob pattern to filter (default: "*")
        recursive: Search recursively (default: False)

    Returns:
        Newline-separated list of files. On error, returns "ERROR: <message>"

    Examples:
        list_files("/tmp/repo")
        list_files("/tmp/repo", pattern="*.yaml")
        list_files("/tmp/repo", pattern="**/*.py", recursive=True)
    """
    try:
        dir_path = Path(path).expanduser().resolve()

        if not dir_path.exists():
            return f"ERROR: Directory not found: {path}"

        if not dir_path.is_dir():
            return f"ERROR: Not a directory: {path}"

        if recursive:
            matches = list(dir_path.rglob(pattern))
        else:
            matches = list(dir_path.glob(pattern))

        # Filter to files only and sort
        files = sorted([str(m.relative_to(dir_path)) for m in matches if m.is_file()])

        if not files:
            return "No files found"

        return '\n'.join(files)

    except PermissionError:
        return f"ERROR: Permission denied: {path}"
    except Exception as e:
        return f"ERROR: {e}"


@tool
def edit_file(
    path: str,
    old_string: str,
    new_string: str,
    encoding: str = "utf-8",
) -> str:
    """
    Edit a file by replacing a specific string with new content.

    This is more efficient than write_file for small changes to large files,
    as you only need to specify the part being changed.

    Args:
        path: Path to the file (absolute or relative)
        old_string: The exact string to find and replace (must be unique in file)
        new_string: The string to replace it with
        encoding: File encoding (default: utf-8)

    Returns:
        Success message or "ERROR: <message>"

    Examples:
        # Change a config value
        edit_file("/tmp/config.yaml", "replicas: 1", "replicas: 3")

        # Update a function
        edit_file("/tmp/app.py",
            "def hello():\\n    return 'Hello'",
            "def hello():\\n    return 'Hello, World!'")

        # Fix a typo
        edit_file("/tmp/README.md", "teh", "the")

    Notes:
        - old_string must exist exactly once in the file
        - If old_string is not found, returns an error
        - If old_string appears multiple times, returns an error (provide more context)
        - Preserves file encoding
    """
    try:
        file_path = Path(path).expanduser().resolve()

        if not file_path.exists():
            return f"ERROR: File not found: {path}"

        if not file_path.is_file():
            return f"ERROR: Not a file: {path}"

        # Check file size
        file_size = file_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            return f"ERROR: File too large ({file_size} bytes, max {MAX_FILE_SIZE})"

        content = file_path.read_text(encoding=encoding)

        # Check if old_string exists
        count = content.count(old_string)
        if count == 0:
            return f"ERROR: String not found in file. Make sure old_string matches exactly (including whitespace/newlines)."
        if count > 1:
            return f"ERROR: String appears {count} times in file. Provide more surrounding context to make it unique."

        # Perform the replacement
        new_content = content.replace(old_string, new_string, 1)

        # Check new content size
        new_size = len(new_content.encode(encoding))
        if new_size > MAX_WRITE_SIZE:
            return f"ERROR: Resulting file too large ({new_size} bytes, max {MAX_WRITE_SIZE})"

        file_path.write_text(new_content, encoding=encoding)

        return f"Successfully edited {path}"

    except UnicodeDecodeError as e:
        return f"ERROR: Encoding error: {e}"
    except PermissionError:
        return f"ERROR: Permission denied: {path}"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['read_file', 'write_file', 'append_file', 'list_files', 'edit_file']
