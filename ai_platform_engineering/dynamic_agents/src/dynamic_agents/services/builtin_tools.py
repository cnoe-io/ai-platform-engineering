"""Built-in tools for Dynamic Agents.

This module provides wrapper functions for built-in tools that can be
configured per-agent with access controls (e.g., domain restrictions).
"""

import json
import logging
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from langchain_core.tools import tool

from dynamic_agents.models import BuiltinToolConfigField, BuiltinToolDefinition, InputField, UserContext

logger = logging.getLogger(__name__)


def get_builtin_tool_definitions() -> list[BuiltinToolDefinition]:
    """Return definitions of all available built-in tools.

    This is used by the /api/v1/builtin-tools endpoint for dynamic UI discovery.
    """
    return [
        BuiltinToolDefinition(
            id="fetch_url",
            name="Fetch URL",
            description="Fetches content from web pages, APIs, or documentation sites",
            enabled_by_default=False,
            runs_in_sandbox=False,
            sandbox_warning=(
                "Runs outside the sandbox — network requests bypass sandbox policies. "
                "Use allowed_domains to restrict access, or disable when strict isolation is needed."
            ),
            config_fields=[
                BuiltinToolConfigField(
                    name="allowed_domains",
                    type="string",
                    label="Allowed Domains",
                    description=(
                        "Comma-separated domain patterns. Use * for all, *.domain.com for subdomains, or exact domain."
                    ),
                    default="*",
                    required=False,
                ),
            ],
        ),
        BuiltinToolDefinition(
            id="current_datetime",
            name="Current Date/Time",
            description="Returns the current date and time in various formats and timezones",
            enabled_by_default=True,
            runs_in_sandbox=False,
        ),
        BuiltinToolDefinition(
            id="user_info",
            name="User Info",
            description="Returns information about the current user (email, name, groups)",
            enabled_by_default=True,
            runs_in_sandbox=False,
        ),
        BuiltinToolDefinition(
            id="sleep",
            name="Sleep",
            description="Pauses execution for a specified duration",
            enabled_by_default=True,
            runs_in_sandbox=False,
            config_fields=[
                BuiltinToolConfigField(
                    name="max_seconds",
                    type="number",
                    label="Max Sleep Duration",
                    description="Maximum allowed sleep duration in seconds (1-3600)",
                    default=300,
                    required=False,
                ),
            ],
        ),
        BuiltinToolDefinition(
            id="request_user_input",
            name="Request User Input",
            description="Requests structured input from the user via a form (HITL)",
            enabled_by_default=True,
            runs_in_sandbox=False,
        ),
    ]


def is_domain_allowed(url_domain: str, allowed_domains_str: str) -> tuple[bool, str]:
    """Check if a domain is allowed by the pattern string.

    Args:
        url_domain: The domain from the URL (e.g., "docs.cisco.com")
        allowed_domains_str: Comma-separated domain patterns

    Returns:
        Tuple of (is_allowed, error_message). error_message is empty if allowed.

    Examples:
        is_domain_allowed("docs.cisco.com", "*") -> (True, "")
        is_domain_allowed("docs.cisco.com", "*.cisco.com") -> (True, "")
        is_domain_allowed("docs.cisco.com", "cisco.com") -> (False, "...")
        is_domain_allowed("cisco.com", "cisco.com") -> (True, "")
        is_domain_allowed("evil.com", "*.cisco.com,*.google.com") -> (False, "...")
    """
    # Empty or whitespace-only = block all
    if not allowed_domains_str or not allowed_domains_str.strip():
        return False, "No domains are allowed (allowed_domains is empty)"

    patterns = [p.strip().lower() for p in allowed_domains_str.split(",") if p.strip()]
    if not patterns:
        return False, "No domains are allowed (allowed_domains is empty)"

    url_domain = url_domain.lower()

    for pattern in patterns:
        if pattern == "*":
            return True, ""  # Wildcard allows all
        elif pattern.startswith("*."):
            # Wildcard subdomain match: *.cisco.com
            base_domain = pattern[2:]  # Remove "*."
            if url_domain == base_domain or url_domain.endswith("." + base_domain):
                return True, ""
        else:
            # Exact match only
            if url_domain == pattern:
                return True, ""

    # Build helpful error message
    return False, f"Domain '{url_domain}' is not allowed. Allowed patterns: {allowed_domains_str}"


def _fetch_url_content(url: str, format: Literal["text", "raw"], timeout: int) -> str:
    """Fetch content from a URL (internal implementation).

    Args:
        url: The URL to fetch
        format: 'text' (extract readable content) or 'raw' (raw HTML)
        timeout: Request timeout in seconds

    Returns:
        Fetched content as string, or "ERROR: <message>" on failure
    """
    try:
        response = requests.get(url, timeout=timeout, allow_redirects=True)
        response.raise_for_status()

        content_type = response.headers.get("content-type", "").lower()

        if "application/json" in content_type:
            return response.text
        elif "text/html" in content_type:
            if format == "raw":
                return response.text
            else:
                soup = BeautifulSoup(response.text, "html.parser")
                for script in soup(["script", "style"]):
                    script.decompose()
                return soup.get_text(separator="\n", strip=True)
        else:
            return response.text

    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response else "Unknown"
        return f"ERROR: HTTP {status_code}: {e}"
    except requests.exceptions.Timeout:
        return f"ERROR: Request timeout after {timeout} seconds"
    except requests.exceptions.RequestException as e:
        return f"ERROR: Network error: {e}"
    except Exception as e:
        return f"ERROR: {e}"


def create_fetch_url_tool(allowed_domains: str = "*"):
    """Create a fetch_url tool with domain restrictions.

    Args:
        allowed_domains: Comma-separated domain patterns.
            - "*" allows all domains
            - "*.cisco.com" allows any subdomain of cisco.com
            - "cisco.com" allows only the exact domain
            - Empty string blocks all domains

    Returns:
        A LangChain tool that wraps fetch_url with domain ACL.
    """

    @tool
    def fetch_url(
        url: str,
        format: Literal["text", "raw"] = "text",
        timeout: int = 30,
    ) -> str:
        """Fetch content from a URL.

        Use this tool to retrieve content from web pages, APIs, or documentation sites.
        The content is extracted as readable text by default.

        Args:
            url: The URL to fetch (must be http:// or https://)
            format: 'text' (extract readable content) or 'raw' (raw HTML)
            timeout: Request timeout in seconds (default: 30)

        Returns:
            Fetched content as string, or error message on failure.

        Example:
            content = fetch_url("https://docs.example.com/guide")
        """
        # Validate URL format
        if not url.startswith(("http://", "https://")):
            return "ERROR: Invalid URL - must start with http:// or https://"

        # Check domain ACL
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            # Strip port if present
            if ":" in domain:
                domain = domain.split(":")[0]

            is_allowed, error_msg = is_domain_allowed(domain, allowed_domains)
            if not is_allowed:
                logger.warning(f"fetch_url domain blocked: {domain} (patterns: {allowed_domains})")
                return f"ERROR: {error_msg}"

        except Exception as e:
            return f"ERROR: Failed to parse URL: {e}"

        # Fetch the content
        logger.debug(f"fetch_url: fetching {url} (domain allowed)")
        return _fetch_url_content(url, format, timeout)

    return fetch_url


def create_current_datetime_tool():
    """Create a current_datetime tool.

    Returns:
        A LangChain tool that returns the current date and time.
    """

    @tool
    def current_datetime(
        timezone_name: str = "UTC",
        format: str = "iso",
    ) -> str:
        """Get the current date and time.

        Use this tool when you need to know the current time or date,
        for scheduling, logging, or time-sensitive operations.

        Args:
            timezone_name: Timezone name (e.g., 'UTC', 'US/Eastern', 'Europe/London').
                         Defaults to 'UTC'.
            format: Output format - 'iso' (ISO 8601), 'human' (readable), or 'unix' (timestamp).
                   Defaults to 'iso'.

        Returns:
            Current date/time in the requested format.

        Example:
            current_datetime()  # Returns ISO format in UTC
            current_datetime(timezone_name="US/Pacific", format="human")
        """
        try:
            import zoneinfo

            try:
                tz = zoneinfo.ZoneInfo(timezone_name)
            except Exception:
                # Fall back to UTC if timezone is invalid
                tz = timezone.utc
                logger.warning(f"Invalid timezone '{timezone_name}', using UTC")

            now = datetime.now(tz)

            if format == "unix":
                return str(int(now.timestamp()))
            elif format == "human":
                return now.strftime("%A, %B %d, %Y at %I:%M:%S %p %Z")
            else:  # iso
                return now.isoformat()

        except Exception as e:
            return f"ERROR: Failed to get current datetime: {e}"

    return current_datetime


def create_user_info_tool(user: UserContext):
    """Create a user_info tool with the current user's information.

    Args:
        user: User context containing email, name, and groups

    Returns:
        A LangChain tool that returns user information.
    """

    @tool
    def user_info() -> dict:
        """Get information about the current user.

        Use this tool when you need to personalize responses, check user identity,
        or access user group memberships for authorization decisions.

        Returns:
            Dictionary with user information:
            - email: User's email address
            - name: User's display name (may be null)
            - groups: List of group names the user belongs to

        Example:
            info = user_info()
            print(f"Hello, {info['name'] or info['email']}!")
        """
        return {
            "email": user.email,
            "name": user.name,
            "groups": user.groups,
        }

    return user_info


def create_sleep_tool(max_seconds: int = 300):
    """Create a sleep tool with configurable max duration.

    Args:
        max_seconds: Maximum allowed sleep duration in seconds (default: 300)

    Returns:
        A LangChain tool that pauses execution.
    """

    @tool
    def sleep(seconds: float) -> str:
        """Pause execution for a specified duration.

        Use this tool when you need to wait between operations, implement
        rate limiting, or add delays for timing-sensitive workflows.

        Args:
            seconds: Duration to sleep in seconds. Must be positive and
                    not exceed the configured maximum.

        Returns:
            Confirmation message with actual sleep duration.

        Example:
            sleep(5)  # Pause for 5 seconds
        """
        if seconds <= 0:
            return "ERROR: Sleep duration must be positive"

        if seconds > max_seconds:
            return f"ERROR: Sleep duration {seconds}s exceeds maximum allowed ({max_seconds}s)"

        try:
            # Use asyncio.sleep if we're in an async context, otherwise time.sleep
            import time

            time.sleep(seconds)
            return f"Slept for {seconds} seconds"
        except Exception as e:
            return f"ERROR: Sleep failed: {e}"

    return sleep


def create_request_user_input_tool():
    """Create a request_user_input tool for HITL forms.

    This tool works with HumanInTheLoopMiddleware via interrupt_on configuration.
    When the agent calls this tool, the middleware intercepts it and pauses execution.
    The agent runtime detects the interrupt, sends an SSE event with form metadata,
    and waits for the user to submit or dismiss the form.

    When resumed, the middleware re-invokes the tool with edited args that have
    field values populated by the user. The tool then extracts and returns those values.

    Returns:
        A LangChain tool for collecting structured user input.
    """

    @tool
    def request_user_input(
        prompt: str,
        fields: list[dict],
    ) -> str:
        """Request structured input from the user via a form.

        Use this tool when you need specific information from the user that
        would benefit from a structured form interface (e.g., configuration values,
        approval decisions, multi-field input).

        The execution will pause until the user submits or dismisses the form.

        Args:
            prompt: Message explaining what information is needed and why.
            fields: List of field definitions. Each field should have:
                - field_name: Unique identifier (snake_case)
                - field_label: Display label (optional, auto-generated from field_name)
                - field_description: Help text (optional)
                - field_type: One of "text", "select", "multiselect", "boolean", "number", "url", "email"
                - field_values: Options for select/multiselect (required for those types)
                - required: Whether field is required (default: false)
                - default_value: Pre-populated value (optional)
                - placeholder: Placeholder text (optional)
                - value: User-provided value (populated when form is submitted)

        Returns:
            JSON string of submitted values ({"field_name": "value", ...}),
            or "Waiting for user input" if fields don't have values yet,
            or error message if validation fails.

        Example:
            result = request_user_input(
                prompt="Please provide deployment configuration:",
                fields=[
                    {"field_name": "environment", "field_type": "select",
                     "field_values": ["dev", "staging", "prod"], "required": True},
                    {"field_name": "replicas", "field_type": "number", "default_value": "3"},
                    {"field_name": "confirm_deploy", "field_type": "boolean",
                     "field_label": "Confirm Deployment", "required": True}
                ]
            )
        """
        # Validate fields against InputField model
        validated_fields = []
        for field_dict in fields:
            try:
                validated = InputField(**field_dict)
                validated_fields.append(validated.model_dump())
            except Exception as e:
                logger.warning(f"Invalid field definition: {field_dict}, error: {e}")
                return f"ERROR: Invalid field definition: {e}"

        # Check if any fields have values (user has submitted the form)
        fields_with_values = [f for f in validated_fields if f.get("value") is not None]

        if not fields_with_values:
            # No values yet - this is the initial call, middleware will intercept
            # and pause execution. Return a placeholder that won't be seen.
            return "Waiting for user input"

        # Check required fields have values
        required_missing = [f["field_name"] for f in validated_fields if f.get("required") and f.get("value") is None]
        if required_missing:
            return f"ERROR: Missing required fields: {', '.join(required_missing)}"

        # Extract values and return as JSON
        result = {}
        for f in validated_fields:
            field_name = f.get("field_name", "")
            value = f.get("value")
            if value is not None:
                result[field_name] = value

        return json.dumps(result)

    return request_user_input


__all__ = [
    "create_fetch_url_tool",
    "create_current_datetime_tool",
    "create_user_info_tool",
    "create_sleep_tool",
    "create_request_user_input_tool",
    "is_domain_allowed",
    "get_builtin_tool_definitions",
]
