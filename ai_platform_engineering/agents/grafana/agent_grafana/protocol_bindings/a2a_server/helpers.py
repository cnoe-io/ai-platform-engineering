# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Helper functions for Grafana Agent A2A server."""

import logging

logger = logging.getLogger(__name__)


def format_grafana_link(grafana_url: str, resource_type: str, uid: str, name: str = None) -> str:
    """
    Format a clickable Grafana link.

    Args:
        grafana_url: Base Grafana URL
        resource_type: Type of resource (dashboard, folder, alert, alert_rule)
        uid: Resource UID
        name: Optional resource name for display

    Returns:
        Markdown formatted link
    """
    display_name = name or uid

    if resource_type == "dashboard":
        url = f"{grafana_url}/d/{uid}"
    elif resource_type == "folder":
        url = f"{grafana_url}/dashboards/f/{uid}"
    elif resource_type == "alert":
        url = f"{grafana_url}/alerting/list"
    elif resource_type == "alert_rule":
        url = f"{grafana_url}/alerting/grafana/{uid}/view"
    else:
        logger.warning(f"Unknown resource type: {resource_type}")
        return display_name

    return f"[{display_name}]({url})"
