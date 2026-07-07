"""Agent-side connector registry.

Connectors are snapshot-driven: sources arrive from the backend's
`ProjectSnapshot` and tokens come from env vars injected at container
start.

Order matters: the registry's iteration order determines section order
in the agent's system prompt and the order of connector-data validation.
"""

from __future__ import annotations

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.connectors.confluence import ConfluenceConnector, ConfluenceExtra
from tome_agent.agent.connectors.github import GitHubConnector, GitHubExtra
from tome_agent.agent.connectors.webex import WebexConnector, WebexExtra

REGISTRY: list[Connector] = [
    GitHubConnector(),
    WebexConnector(),
    ConfluenceConnector(),
]

__all__ = [
    "REGISTRY",
    "Connector",
    "ConfluenceConnector",
    "ConfluenceExtra",
    "GitHubConnector",
    "GitHubExtra",
    "SourceItem",
    "WebexConnector",
    "WebexExtra",
    "format_pages",
]
