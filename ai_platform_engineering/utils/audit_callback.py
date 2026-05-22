# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
LangChain callback handler for unified audit logging.

Records tool invocations (start / success / error) to the ``audit_events``
MongoDB collection via :mod:`audit_logger`.  Follows the same pattern as
:class:`MetricsCallbackHandler` so it can be attached to any
``RunnableConfig.callbacks`` list.
"""

import logging
import os
import time
from typing import Any, Dict, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from .audit_logger import log_audit_event

logger = logging.getLogger(__name__)


class AuditCallbackHandler(BaseCallbackHandler):
    """Persist tool-level audit events to MongoDB.

    Usage::

        from ai_platform_engineering.utils.audit_callback import AuditCallbackHandler

        handler = AuditCallbackHandler(
            agent_name="argocd",
            user_email="alice@example.com",
            context_id="conv-123",
            trace_id="abc-def",
        )
        config = RunnableConfig(callbacks=[handler])

    Args:
        agent_name: Name of the owning agent (for labelling).
        user_email: Authenticated user's email (may be ``None``).
        context_id: Conversation / session identifier.
        trace_id: Distributed trace correlation id.
        tenant_id: Tenant / org identifier (defaults to ``"default"``).
    """

    def __init__(
        self,
        agent_name: str = "unknown",
        user_email: Optional[str] = None,
        context_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        tenant_id: str = "default",
    ) -> None:
        super().__init__()
        self.agent_name = agent_name
        self.user_email = user_email
        self.context_id = context_id
        self.trace_id = trace_id
        self.tenant_id = tenant_id
        self._tool_start_times: Dict[UUID, float] = {}
        self._tool_names: Dict[UUID, str] = {}
        self._enabled = os.getenv("AUDIT_ENABLED", "true").lower() == "true"

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
        if not self._enabled:
            return
        tool_name = serialized.get("name", "unknown")
        self._tool_start_times[run_id] = time.time()
        self._tool_names[run_id] = tool_name

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        if not self._enabled:
            return

        start_time = self._tool_start_times.pop(run_id, None)
        tool_name = self._tool_names.pop(run_id, "unknown")
        duration_ms = (time.time() - start_time) * 1000 if start_time else None

        log_audit_event(
            event_type="tool_action",
            outcome="success",
            action=tool_name,
            tool_name=tool_name,
            agent_name=self.agent_name,
            user_email=self.user_email,
            duration_ms=duration_ms,
            correlation_id=self.trace_id,
            context_id=self.context_id,
            tenant_id=self.tenant_id,
            component=self.agent_name,
        )

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        if not self._enabled:
            return

        start_time = self._tool_start_times.pop(run_id, None)
        tool_name = self._tool_names.pop(run_id, "unknown")
        duration_ms = (time.time() - start_time) * 1000 if start_time else None

        log_audit_event(
            event_type="tool_action",
            outcome="error",
            action=tool_name,
            tool_name=tool_name,
            agent_name=self.agent_name,
            user_email=self.user_email,
            duration_ms=duration_ms,
            reason_code=str(error)[:500],
            correlation_id=self.trace_id,
            context_id=self.context_id,
            tenant_id=self.tenant_id,
            component=self.agent_name,
        )
