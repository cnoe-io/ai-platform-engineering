# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
LangChain callback handler for Prometheus metrics.

This callback handler tracks MCP tool calls without modifying tools.
"""

import logging
import os
import time
from typing import Any, Dict, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from .agent_metrics import record_mcp_tool_execution

logger = logging.getLogger(__name__)


class MetricsCallbackHandler(BaseCallbackHandler):
    """
    LangChain callback handler that records Prometheus metrics for tool calls.

    Usage:
        from ai_platform_engineering.utils.metrics import MetricsCallbackHandler

        handler = MetricsCallbackHandler(agent_name="argocd")
        config = RunnableConfig(callbacks=[handler])
    """

    def __init__(self, agent_name: str = "unknown"):
        """
        Initialize the metrics callback handler.

        Args:
            agent_name: Name of the agent for metric labels
        """
        super().__init__()
        self.agent_name = agent_name
        self._tool_start_times: Dict[UUID, float] = {}
        self._tool_names: Dict[UUID, str] = {}
        self._enabled = os.getenv("METRICS_ENABLED", "false").lower() == "true"

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[list[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        inputs: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Record tool start time."""
        if not self._enabled:
            return

        tool_name = serialized.get("name", "unknown")
        self._tool_start_times[run_id] = time.time()
        self._tool_names[run_id] = tool_name
        logger.info(f"📊 Tool started: {tool_name}")

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record tool completion metrics."""
        if not self._enabled:
            return

        start_time = self._tool_start_times.pop(run_id, None)
        tool_name = self._tool_names.pop(run_id, "unknown")

        if start_time:
            duration = time.time() - start_time
            record_mcp_tool_execution(
                tool_name=tool_name,
                agent_name=self.agent_name,
                status="success",
                duration=duration,
            )
            logger.info(f"📊 Tool completed: {tool_name}, duration={duration:.2f}s")

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record tool error metrics."""
        if not self._enabled:
            return

        start_time = self._tool_start_times.pop(run_id, None)
        tool_name = self._tool_names.pop(run_id, "unknown")

        if start_time:
            duration = time.time() - start_time
            record_mcp_tool_execution(
                tool_name=tool_name,
                agent_name=self.agent_name,
                status="error",
                duration=duration,
            )
            logger.info(f"📊 Tool error: {tool_name}, duration={duration:.2f}s, error={error}")

