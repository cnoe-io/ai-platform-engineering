# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AWS AgentExecutor implementation using common base class."""

import logging

from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import BaseStrandsAgentExecutor
from agent_aws.agent import AWSAgent

logger = logging.getLogger(__name__)


class AWSAgentExecutor(BaseStrandsAgentExecutor):
    """AWS AgentExecutor implementation."""

    def __init__(self):
        """Initialize with AWS agent."""
        super().__init__(AWSAgent())
        logger.info("AWS Agent Executor initialized (using BaseStrandsAgentExecutor)")
