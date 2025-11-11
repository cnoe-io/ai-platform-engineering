# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from typing import Optional

from pydantic import BaseModel


class InputState(BaseModel):
    """Input state for Grafana agent."""
    query: Optional[str] = None


class OutputState(BaseModel):
    """Output state for Grafana agent."""
    response: Optional[str] = None
    dashboards: Optional[list] = None
    alerts: Optional[list] = None
    metrics: Optional[dict] = None


class AgentState(BaseModel):
    """Overall state for Grafana agent."""
    grafana_input: Optional[InputState] = None
    grafana_output: Optional[OutputState] = None
    input: Optional[dict] = None  # Add field to capture client input
