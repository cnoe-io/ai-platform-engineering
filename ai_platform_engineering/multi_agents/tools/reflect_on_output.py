"""
Reflection tool for validating agent outputs against user requirements.

This tool acts as a quality gate that validates whether the agent's output
meets the user's original request. If validation fails, it provides specific
feedback that the agent can use to create corrective TODO items.
"""

from langchain_core.tools import tool
from typing import List


@tool
def reflect_on_output(
    user_request: str,
    actual_output: str,
    requirements: List[str]
) -> str:
    """
    Validate that your output meets the user's requirements.

    Args:
        user_request: The original user request/query
        actual_output: The output you generated (markdown, table, list, etc.)
        requirements: List of specific requirements from the user request

    Returns:
        Validation result as string (PASSED or FAILED with issues/suggestions)

    Example:
        reflect_on_output(
            user_request="tabulate jira issues with links",
            actual_output="| Issue | Link |\\n|---|---|\\n| JIRA-123 | http... |",
            requirements=["markdown table", "include jira links"]
        )
    """

    issues = []
    suggestions = []

    # Extract key requirements from the user request
    request_lower = user_request.lower()
    output_lower = actual_output.lower()

    # Check for table requirement
    if any(keyword in request_lower for keyword in ['table', 'tabulate', 'tabular']):
        # Check if output is actually a markdown table
        has_table_header = '|' in actual_output and ('---' in actual_output or '--|' in actual_output)
        has_numbered_list = any(actual_output.strip().startswith(f"{i}.") for i in range(1, 20))
        has_bullet_list = any(line.strip().startswith(('-', '•', '*')) for line in actual_output.split('\n') if line.strip())

        if not has_table_header:
            if has_numbered_list:
                issues.append("Output is a numbered list, but user requested a table")
                suggestions.append("Convert the numbered list into a markdown table format with | separators and column headers")
            elif has_bullet_list:
                issues.append("Output is a bullet list, but user requested a table")
                suggestions.append("Convert the bullet list into a markdown table format with | separators and column headers")
            else:
                issues.append("Output is not in table format, but user requested a table")
                suggestions.append("Format the data as a markdown table with proper column headers and | separators")

    # Check for column requirements
    for req in requirements:
        req_lower = req.lower()

        # Check for link requirements
        if any(keyword in req_lower for keyword in ['link', 'url', 'href']):
            # Check if output contains markdown links [text](url) or bare URLs
            has_markdown_links = '](' in actual_output
            has_bare_urls = 'http' in actual_output

            if not (has_markdown_links or has_bare_urls):
                issues.append(f"Missing requirement: {req}")
                suggestions.append(f"Add clickable links in markdown format [Link Text](URL) for {req}")

        # Check for specific fields mentioned in requirements
        if any(keyword in req_lower for keyword in ['assignee', 'assigned to', 'owner']):
            if 'assignee' not in output_lower and 'assigned' not in output_lower:
                issues.append(f"Missing required field: {req}")
                suggestions.append(f"Include the {req} information in your output")

        if any(keyword in req_lower for keyword in ['creator', 'reporter', 'requester', 'created by']):
            if 'creator' not in output_lower and 'reporter' not in output_lower and 'created' not in output_lower:
                issues.append(f"Missing required field: {req}")
                suggestions.append(f"Include the {req} information in your output")

        if 'date' in req_lower or 'time' in req_lower:
            # Check for date patterns
            has_dates = any(pattern in actual_output for pattern in ['2025', '2024', '2023', 'Jan', 'Feb', 'Mar', 'Apr', 'May'])
            if not has_dates:
                issues.append(f"Missing required field: {req}")
                suggestions.append(f"Include date/time information as specified in {req}")

    # Check for sorting requirements
    if any(keyword in request_lower for keyword in ['sort', 'order', 'latest', 'oldest', 'newest']):
        if 'latest' in request_lower or 'newest' in request_lower or 'descending' in request_lower:
            issues.append("Cannot automatically verify date sorting - please manually verify data is sorted from latest to oldest")
            suggestions.append("Review the output to ensure items are sorted by date in descending order (newest first)")

    # Determine validation result
    is_valid = len(issues) == 0

    if is_valid:
        return "✅ PASSED - All requirements met. Proceed with presenting results to user."
    else:
        result_lines = [f"❌ FAILED - {len(issues)} issue(s) found:"]
        for i, issue in enumerate(issues, 1):
            result_lines.append(f"  {i}. Issue: {issue}")
            if i <= len(suggestions):
                result_lines.append(f"     Fix: {suggestions[i-1]}")
        result_lines.append("\nCreate TODO items for each issue and re-validate after fixing.")
        return '\n'.join(result_lines)
