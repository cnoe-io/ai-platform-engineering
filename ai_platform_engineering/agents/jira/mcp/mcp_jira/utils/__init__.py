"""
Utility functions for the MCP Jira integration.
This package provides various utility functions used throughout the codebase.
"""

from .date import parse_date
from .io import is_read_only_mode
from .logging import setup_logging

# Export OAuth utilities
from .oauth import OAuthConfig, configure_oauth_session
from .ssl import SSLIgnoreAdapter, configure_ssl_verification
from .urls import is_atlassian_cloud_url

# Export field discovery utilities (new)
from .field_discovery import FieldDiscovery, get_field_discovery

# Export ADF utilities
from .adf import (
    text_to_adf,
    adf_to_text,
    is_adf_format,
    ensure_adf_format,
    create_empty_adf,
)

# Export all utility functions for backward compatibility
__all__ = [
    "SSLIgnoreAdapter",
    "configure_ssl_verification",
    "is_atlassian_cloud_url",
    "is_read_only_mode",
    "setup_logging",
    "parse_date",
    "parse_iso8601_date",
    "OAuthConfig",
    "configure_oauth_session",
    "FieldDiscovery",
    "get_field_discovery",
    "text_to_adf",
    "adf_to_text",
    "is_adf_format",
    "ensure_adf_format",
    "create_empty_adf",
]
