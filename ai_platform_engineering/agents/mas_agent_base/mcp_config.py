"""MCP (Model Context Protocol) configuration helpers."""

import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class MCPConfig:
    """Configuration for MCP server connection."""

    server_name: str
    server_path: str
    required_env_vars: List[str]
    optional_env_vars: Optional[List[str]] = None
    transport: str = "stdio"  # stdio, http, or sse
    http_url: Optional[str] = None  # For http/sse transport
    http_headers: Optional[Dict[str, str]] = None  # Custom HTTP headers (e.g., auth)

    def validate_env_vars(self) -> None:
        """Validate that required environment variables are set.

        Raises:
            ValueError: If any required environment variables are missing
        """
        missing = []
        for var in self.required_env_vars:
            if not os.getenv(var):
                missing.append(var)

        if missing:
            error_msg = f"Missing required environment variables for {self.server_name}: {', '.join(missing)}"
            logger.error(error_msg)
            raise ValueError(error_msg)

        # Log warnings for optional vars
        if self.optional_env_vars:
            for var in self.optional_env_vars:
                if not os.getenv(var):
                    logger.warning(f"Optional environment variable not set: {var}")

    def get_client_config(self) -> Dict[str, Dict]:
        """Generate MCP client configuration dictionary.

        Returns:
            Configuration dictionary for MCP client

        Raises:
            ValueError: If required environment variables are missing or transport is unsupported
        """
        # Validate environment variables (raises if missing)
        self.validate_env_vars()

        if self.transport == "stdio":
            return {
                self.server_name: {
                    "command": "python",
                    "args": [self.server_path],
                }
            }
        elif self.transport in ("http", "sse"):
            # Both HTTP and SSE use streamable_http transport in langchain-mcp-adapters
            if not self.http_url:
                raise ValueError(f"http_url required for {self.transport} transport")
            config = {
                self.server_name: {
                    "url": self.http_url,
                    "transport": "streamable_http",  # langchain-mcp uses this for both HTTP and SSE
                }
            }
            # Add custom headers if provided
            if self.http_headers:
                config[self.server_name]["headers"] = self.http_headers
            return config
        else:
            raise ValueError(f"Unsupported transport: {self.transport}. Supported: stdio, http, sse")
