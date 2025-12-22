# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Glob Tool - Pathname Pattern Matching

This tool provides glob pattern matching for finding files and directories.
Based on the UNIX glob(7) specification for wildcard pathname expansion.

Glob patterns support:
- '?' matches any single character
- '*' matches any string (including empty)
- '[...]' matches character classes
- '[!...]' matches complement of character class
- Ranges like [a-z] or [0-9]

Reference: https://man7.org/linux/man-pages/man7/glob.7.html
"""

from typing import Dict, Any, List, Optional
from langchain_core.tools import tool
import glob
import os
from pathlib import Path


@tool
def glob_find(
    pattern: str,
    recursive: bool = False,
    include_hidden: bool = False,
    dirs_only: bool = False,
    files_only: bool = False,
    absolute_paths: bool = False
) -> Dict[str, Any]:
    """
    Find files and directories matching a glob pattern.

    This tool uses UNIX glob patterns to match pathnames. Glob patterns
    support wildcards for flexible file searching.

    Wildcard Patterns:
        - '?' matches any single character
        - '*' matches any string (zero or more characters)
        - '**' matches zero or more directories (when recursive=True)
        - '[abc]' matches any character in the set (a, b, or c)
        - '[a-z]' matches any character in the range (a through z)
        - '[!abc]' matches any character NOT in the set

    Args:
        pattern: Glob pattern to match (e.g., "*.py", "src/**/*.js", "[a-z]*.txt")
        recursive: Enable recursive matching with '**' (default: False)
        include_hidden: Include hidden files/directories starting with '.' (default: False)
        dirs_only: Return only directories (default: False)
        files_only: Return only files (default: False)
        absolute_paths: Return absolute paths instead of relative (default: False)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - matches: List of matching paths
        - count: Number of matches found
        - pattern: Original pattern used
        - message: Human-readable status message
        - error: Error message (if failed)

    Examples:
        # Find all Python files in current directory
        result = glob_find("*.py")

        # Find all JavaScript files recursively
        result = glob_find("**/*.js", recursive=True)

        # Find all files starting with 'test' or 'Test'
        result = glob_find("[tT]est*.py")

        # Find all files in 'src' directory matching pattern
        result = glob_find("src/**/*.json", recursive=True)

        # Find only directories matching pattern
        result = glob_find("test_*", dirs_only=True)

        # Find files with single character extension
        result = glob_find("file.?")

    Notes:
        - Hidden files (starting with '.') are excluded by default
        - Use recursive=True to enable '**' for directory recursion
        - Patterns are relative to current working directory
        - Empty results are valid (success=True, matches=[])

    Reference:
        Based on UNIX glob(7): https://man7.org/linux/man-pages/man7/glob.7.html
    """
    try:
        # Use glob.glob for pattern matching
        matches = glob.glob(pattern, recursive=recursive)

        # Filter hidden files if not included
        if not include_hidden:
            matches = [
                m for m in matches
                if not any(part.startswith('.') for part in Path(m).parts)
            ]

        # Filter by type if specified
        if dirs_only:
            matches = [m for m in matches if os.path.isdir(m)]
        elif files_only:
            matches = [m for m in matches if os.path.isfile(m)]

        # Convert to absolute paths if requested
        if absolute_paths:
            matches = [os.path.abspath(m) for m in matches]

        # Sort for consistent output
        matches.sort()

        return {
            'success': True,
            'matches': matches,
            'count': len(matches),
            'pattern': pattern,
            'message': f'Found {len(matches)} matches for pattern "{pattern}"'
        }

    except Exception as e:
        return {
            'success': False,
            'matches': [],
            'count': 0,
            'pattern': pattern,
            'error': str(e),
            'message': f'Glob pattern matching failed: {str(e)}'
        }


@tool
def glob_expand(
    patterns: List[str],
    recursive: bool = False,
    include_hidden: bool = False
) -> Dict[str, Any]:
    """
    Expand multiple glob patterns into a combined list of matching paths.

    This tool takes multiple glob patterns and returns all unique matches
    across all patterns. Useful for finding files matching any of several
    patterns.

    Args:
        patterns: List of glob patterns to expand
        recursive: Enable recursive matching with '**' (default: False)
        include_hidden: Include hidden files (default: False)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - matches: Combined list of unique matching paths
        - count: Total number of unique matches
        - patterns: Original patterns used
        - per_pattern_counts: Dict mapping each pattern to its match count
        - message: Human-readable status message
        - error: Error message (if failed)

    Examples:
        # Find all Python and JavaScript files
        result = glob_expand(["*.py", "*.js"])

        # Find config files with multiple extensions
        result = glob_expand(["*.yaml", "*.yml", "*.json"])

        # Find test files in multiple directories
        result = glob_expand([
            "tests/**/*.py",
            "integration/**/*.py"
        ], recursive=True)
    """
    try:
        all_matches = set()
        per_pattern_counts = {}

        for pattern in patterns:
            matches = glob.glob(pattern, recursive=recursive)

            # Filter hidden files if not included
            if not include_hidden:
                matches = [
                    m for m in matches
                    if not any(part.startswith('.') for part in Path(m).parts)
                ]

            per_pattern_counts[pattern] = len(matches)
            all_matches.update(matches)

        # Convert to sorted list
        matches_list = sorted(list(all_matches))

        return {
            'success': True,
            'matches': matches_list,
            'count': len(matches_list),
            'patterns': patterns,
            'per_pattern_counts': per_pattern_counts,
            'message': f'Found {len(matches_list)} unique matches across {len(patterns)} patterns'
        }

    except Exception as e:
        return {
            'success': False,
            'matches': [],
            'count': 0,
            'patterns': patterns,
            'error': str(e),
            'message': f'Pattern expansion failed: {str(e)}'
        }


@tool
def glob_test(
    pattern: str,
    test_path: str
) -> Dict[str, Any]:
    """
    Test if a specific path matches a glob pattern.

    Args:
        pattern: Glob pattern to test against
        test_path: Path to test

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - matches: Whether the path matches the pattern
        - pattern: Pattern used for testing
        - test_path: Path that was tested
        - message: Human-readable result

    Example:
        result = glob_test("*.py", "script.py")
        print(result['matches'])  # True
    """
    try:
        from fnmatch import fnmatch

        # Test if path matches pattern
        matches = fnmatch(test_path, pattern)

        return {
            'success': True,
            'matches': matches,
            'pattern': pattern,
            'test_path': test_path,
            'message': f'Path "{test_path}" {"matches" if matches else "does not match"} pattern "{pattern}"'
        }

    except Exception as e:
        return {
            'success': False,
            'matches': False,
            'pattern': pattern,
            'test_path': test_path,
            'error': str(e),
            'message': f'Pattern test failed: {str(e)}'
        }


# Export for use in agent tool lists
__all__ = ['glob_find', 'glob_expand', 'glob_test']




