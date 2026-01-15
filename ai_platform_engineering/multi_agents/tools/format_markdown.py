# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Markdown Formatting and Validation Tool

Uses mdformat library (the "Black" of markdown) for reliable, opinionated formatting.
"""

from langchain_core.tools import tool


def _format_with_mdformat(text: str) -> str:
    """Format markdown using mdformat library."""
    try:
        import mdformat
    except ImportError:
        raise ImportError("mdformat is not installed. Install it with: pip install mdformat")

    try:
        return mdformat.text(text)
    except Exception as e:
        raise Exception(f"Markdown formatting failed: {e}")


@tool
def format_markdown(
    markdown_text: str,
    validate_only: bool = False
) -> str:
    """
    Format and validate markdown text.

    Args:
        markdown_text: The markdown text to format/validate
        validate_only: If True, only validate without fixing

    Returns:
        Formatted markdown text, or validation result string

    Example:
        formatted = format_markdown(my_response_text)
    """
    if validate_only:
        try:
            formatted = _format_with_mdformat(markdown_text)
            has_issues = formatted.strip() != markdown_text.strip()
            if has_issues:
                return "VALIDATION: Issues detected - tables, spacing, or structure need fixing"
            return "VALIDATION: Markdown is properly formatted"
        except ImportError as e:
            return f"ERROR: {e}"
        except Exception as e:
            return f"ERROR: Validation failed: {e}"

    try:
        formatted = _format_with_mdformat(markdown_text)
        return formatted
    except ImportError as e:
        return f"ERROR: {e}"
    except Exception as e:
        return f"ERROR: Formatting failed: {e}"


# Export for use in agent tool lists
__all__ = ['format_markdown']
