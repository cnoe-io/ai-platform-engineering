# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Markdown Formatting and Validation Tool

This tool provides markdown formatting and validation capabilities to ensure
clean, properly formatted markdown output across all agents.

Uses mdformat library (the "Black" of markdown) for reliable, opinionated formatting.
"""

from typing import Dict, Any
from langchain_core.tools import tool


def _format_with_mdformat(text: str) -> str:
    """
    Format markdown using mdformat library.

    Args:
        text: Markdown text to format

    Returns:
        Formatted markdown text

    Raises:
        ImportError: If mdformat is not installed
        Exception: If formatting fails
    """
    try:
        import mdformat
    except ImportError:
        raise ImportError(
            "mdformat is not installed. Install it with: pip install mdformat"
        )

    try:
        # Format the markdown text
        # mdformat.text() returns formatted markdown with normalized line endings
        formatted = mdformat.text(text)
        return formatted
    except Exception as e:
        # If formatting fails, return original text
        raise Exception(f"Markdown formatting failed: {str(e)}")


@tool
def format_markdown(
    markdown_text: str,
    validate_only: bool = False
) -> Dict[str, Any]:
    """
    Format and validate markdown text to ensure clean, properly formatted output.

    This tool uses mdformat (the "Black" of markdown) to automatically fix common issues:
    - Broken tables (missing alignment rows, separators)
    - Inconsistent spacing around formatted elements
    - Header formatting issues
    - List formatting inconsistencies
    - Code block formatting
    - Link and image formatting

    Args:
        markdown_text: The markdown text to format/validate
        validate_only: If True, only validate without fixing. Returns validation results.

    Returns:
        Dict containing:
        - formatted_text: The cleaned markdown (if validate_only=False)
        - validation: Validation results
        - fixed_issues: Count of issues that were auto-fixed (0 or 1)
        - message: Human-readable status message

    Example:
        # Format markdown before returning to user
        result = format_markdown(my_response_text)
        return result['formatted_text']

        # Just validate to check for issues
        validation = format_markdown(my_response_text, validate_only=True)
        if not validation['validation']['valid']:
            print(validation['message'])
    """
    if validate_only:
        # Check if formatting would change anything
        try:
            formatted = _format_with_mdformat(markdown_text)
            has_issues = formatted.strip() != markdown_text.strip()

            return {
                'validation': {
                    'valid': not has_issues,
                    'issues': ['Markdown formatting issues detected - tables, spacing, or structure need fixing'] if has_issues else [],
                    'issue_count': 1 if has_issues else 0
                },
                'message': 'Formatting issues detected (tables, spacing, or structure)' if has_issues else 'Markdown is properly formatted'
            }
        except ImportError as e:
            return {
                'validation': {
                    'valid': False,
                    'issues': [str(e)],
                    'issue_count': 1
                },
                'message': f'Validation unavailable: {str(e)}'
            }
        except Exception as e:
            return {
                'validation': {
                    'valid': False,
                    'issues': [f'Validation error: {str(e)}'],
                    'issue_count': 1
                },
                'message': f'Validation error: {str(e)}'
            }

    # Format the markdown
    try:
        formatted = _format_with_mdformat(markdown_text)

        # Check if anything changed
        has_changes = formatted.strip() != markdown_text.strip()
        fixed_count = 1 if has_changes else 0

        return {
            'formatted_text': formatted,
            'validation': {
                'valid': True,
                'issues': [],
                'issue_count': 0
            },
            'fixed_issues': fixed_count,
            'remaining_issues': 0,
            'message': 'Successfully formatted markdown (fixed tables, spacing, headers)' if fixed_count else 'No formatting changes needed'
        }
    except ImportError as e:
        # mdformat not installed - return original text with warning
        return {
            'formatted_text': markdown_text,
            'validation': {
                'valid': False,
                'issues': [str(e)],
                'issue_count': 1
            },
            'fixed_issues': 0,
            'remaining_issues': 1,
            'message': f'Formatting unavailable: {str(e)}. Returning original text.'
        }
    except Exception as e:
        # Formatting failed - return original text
        return {
            'formatted_text': markdown_text,
            'validation': {
                'valid': False,
                'issues': [str(e)],
                'issue_count': 1
            },
            'fixed_issues': 0,
            'remaining_issues': 1,
            'message': f'Formatting failed: {str(e)}. Returning original text.'
        }


# Export for use in agent tool lists
__all__ = ['format_markdown']
