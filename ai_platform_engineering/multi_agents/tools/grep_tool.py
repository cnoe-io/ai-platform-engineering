# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Grep Tool

This tool provides capabilities to search for patterns in files, useful for:
- Searching for text patterns in files
- Finding code snippets
- Analyzing log files
- Pattern matching in documentation
"""

from typing import Dict, Any, Optional
from langchain_core.tools import tool
import subprocess
import shlex


@tool
def grep_search(
    pattern: str,
    path: str,
    recursive: bool = True,
    ignore_case: bool = False,
    line_numbers: bool = True,
    max_results: int = 100,
    file_pattern: Optional[str] = None
) -> Dict[str, Any]:
    """
    Search for a pattern in files using grep.

    This tool searches for text patterns in files and directories.
    Useful for finding code snippets, log entries, or any text content.

    Args:
        pattern: The text pattern to search for (can be a regex)
        path: File or directory path to search in
        recursive: Search recursively in subdirectories (default: True)
        ignore_case: Case-insensitive search (default: False)
        line_numbers: Show line numbers in results (default: True)
        max_results: Maximum number of matching lines to return (default: 100)
        file_pattern: Optional file pattern to match (e.g., "*.py", "*.log")

    Returns:
        Dict containing:
        - success: Whether the search succeeded
        - matches: List of matching lines with file paths and line numbers
        - match_count: Number of matches found
        - truncated: Whether results were truncated (exceeded max_results)
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        # Search for "TODO" in Python files
        result = grep_search("TODO", "/app", file_pattern="*.py")

        # Case-insensitive search
        result = grep_search("error", "/var/log", ignore_case=True)

        # Search in specific file
        result = grep_search("function", "/app/main.py", recursive=False)

    Notes:
        - Uses standard grep utility
        - Results are limited to max_results to prevent overwhelming output
        - For large directories, consider using file_pattern to narrow search
        - Returns empty matches if pattern not found (success=True, matches=[])
    """
    try:
        # Build grep command
        args = ['grep']

        # Add options
        if ignore_case:
            args.append('-i')

        if line_numbers:
            args.append('-n')

        if recursive:
            args.append('-r')

        # Include file pattern if specified
        if file_pattern:
            args.extend(['--include', file_pattern])

        # Add pattern and path
        args.extend([pattern, path])

        # Execute grep
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=60  # 1 minute timeout
        )

        # grep returns 0 for matches found, 1 for no matches, >1 for errors
        if result.returncode > 1:
            return {
                'success': False,
                'matches': [],
                'match_count': 0,
                'error': result.stderr or 'Grep command failed',
                'message': f'Search failed: {result.stderr}'
            }

        # Parse output
        output_lines = result.stdout.strip().split('\n') if result.stdout.strip() else []

        # Limit results
        truncated = len(output_lines) > max_results
        matches = output_lines[:max_results]

        # No matches found (grep returns 1)
        if result.returncode == 1:
            return {
                'success': True,
                'matches': [],
                'match_count': 0,
                'truncated': False,
                'message': f'No matches found for pattern "{pattern}"'
            }

        return {
            'success': True,
            'matches': matches,
            'match_count': len(output_lines),
            'truncated': truncated,
            'message': f'Found {len(output_lines)} matches for pattern "{pattern}"' +
                      (f' (showing first {max_results})' if truncated else '')
        }

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'matches': [],
            'match_count': 0,
            'error': 'Search timed out after 60 seconds',
            'message': 'Search operation timed out - try narrowing your search scope'
        }
    except FileNotFoundError:
        return {
            'success': False,
            'matches': [],
            'match_count': 0,
            'error': 'grep command not found',
            'message': 'grep utility is not installed or not in PATH'
        }
    except Exception as e:
        return {
            'success': False,
            'matches': [],
            'match_count': 0,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


@tool
def grep_count(
    pattern: str,
    path: str,
    recursive: bool = True,
    ignore_case: bool = False,
    file_pattern: Optional[str] = None
) -> Dict[str, Any]:
    """
    Count occurrences of a pattern in files.

    Args:
        pattern: The text pattern to search for
        path: File or directory path to search in
        recursive: Search recursively in subdirectories (default: True)
        ignore_case: Case-insensitive search (default: False)
        file_pattern: Optional file pattern to match (e.g., "*.py")

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - counts: Dict mapping file paths to match counts
        - total_matches: Total number of matches across all files
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = grep_count("TODO", "/app/src", file_pattern="*.py")
        print(f"Total TODOs: {result['total_matches']}")
    """
    try:
        args = ['grep', '-c']

        if ignore_case:
            args.append('-i')

        if recursive:
            args.append('-r')

        if file_pattern:
            args.extend(['--include', file_pattern])

        args.extend([pattern, path])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode > 1:
            return {
                'success': False,
                'counts': {},
                'total_matches': 0,
                'error': result.stderr or 'Grep command failed',
                'message': f'Count failed: {result.stderr}'
            }

        # Parse output (format: filename:count)
        counts = {}
        total = 0

        if result.stdout.strip():
            for line in result.stdout.strip().split('\n'):
                if ':' in line:
                    filepath, count_str = line.rsplit(':', 1)
                    try:
                        count = int(count_str)
                        if count > 0:  # Only include files with matches
                            counts[filepath] = count
                            total += count
                    except ValueError:
                        continue

        return {
            'success': True,
            'counts': counts,
            'total_matches': total,
            'files_with_matches': len(counts),
            'message': f'Found {total} total matches in {len(counts)} files'
        }

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'counts': {},
            'total_matches': 0,
            'error': 'Count operation timed out after 60 seconds',
            'message': 'Count operation timed out'
        }
    except Exception as e:
        return {
            'success': False,
            'counts': {},
            'total_matches': 0,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


# Export for use in agent tool lists
__all__ = ['grep_search', 'grep_count']




