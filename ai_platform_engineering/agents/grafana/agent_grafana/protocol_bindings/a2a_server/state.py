# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""State management for Grafana Agent."""

from dataclasses import dataclass, field
from typing import List, Dict, Any


@dataclass
class GrafanaAgentState:
    """State for Grafana agent conversations."""

    messages: List[Dict[str, Any]] = field(default_factory=list)
    thread_id: str = "default"
    grafana_url: str = ""
    last_query: str = ""
