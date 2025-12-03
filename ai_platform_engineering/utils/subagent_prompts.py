# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Sub-Agent Prompt Configuration Loader

This module provides utilities for loading sub-agent prompts from YAML config files,
similar to how the supervisor agent loads its prompts from prompt_config.yaml.

Usage:
    from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config

    config = load_subagent_prompt_config("argocd")
    system_instruction = config.get_system_instruction()
"""

import os
import yaml
import logging
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

from ai_platform_engineering.utils.prompt_templates import (
    build_system_instruction,
    scope_limited_agent_instruction,
    graceful_error_handling_template,
    AgentCapability,
    SCOPE_LIMITED_GUIDELINES,
    STANDARD_RESPONSE_GUIDELINES,
    HUMAN_IN_LOOP_NOTES,
    LOGGING_NOTES,
    DATE_HANDLING_NOTES,
)

logger = logging.getLogger(__name__)


@dataclass
class SubAgentPromptConfig:
    """Configuration holder for sub-agent prompts loaded from YAML."""

    agent_name: str
    agent_description: str
    agent_purpose: str
    response_guidelines: List[str]
    additional_guidelines: List[str]
    important_notes: List[str]
    tool_usage_guidelines: Dict[str, str]
    additional_sections: Dict[str, str]
    capabilities: List[AgentCapability]
    include_error_handling: bool
    include_date_handling: bool
    include_human_in_loop: bool
    include_logging_notes: bool
    response_format_instruction: str
    tool_working_message: str
    tool_processing_message: str
    # Raw config for custom use
    raw_config: Dict[str, Any]

    def get_system_instruction(self) -> str:
        """
        Build the system instruction from the loaded configuration.

        Uses build_system_instruction for complex agents with capabilities,
        tool_usage_guidelines, or additional_sections.
        Uses scope_limited_agent_instruction for simpler agents.
        """
        # If we have capabilities, tool_usage_guidelines, or additional_sections,
        # use the full build_system_instruction
        if self.capabilities or self.tool_usage_guidelines or self.additional_sections:
            logger.info(f"Using build_system_instruction for {self.agent_name}")
            # Build important notes list
            important_notes = []
            if self.include_human_in_loop:
                important_notes.extend(HUMAN_IN_LOOP_NOTES)
            if self.include_logging_notes:
                important_notes.extend(LOGGING_NOTES)
            if self.include_date_handling:
                important_notes.extend(DATE_HANDLING_NOTES)
            important_notes.extend(self.important_notes)

            return build_system_instruction(
                agent_name=self.agent_name.upper() + " AGENT",
                agent_purpose=self.agent_purpose,
                capabilities=self.capabilities if self.capabilities else None,
                response_guidelines=SCOPE_LIMITED_GUIDELINES + STANDARD_RESPONSE_GUIDELINES + self.response_guidelines,
                important_notes=important_notes if important_notes else None,
                tool_usage_guidelines=self.tool_usage_guidelines if self.tool_usage_guidelines else None,
                additional_sections=self.additional_sections if self.additional_sections else None,
                graceful_error_handling=graceful_error_handling_template(self.agent_name) if self.include_error_handling else None
            )
        else:
            # Use scope_limited_agent_instruction for simpler agents
            logger.info(f"Using scope_limited_agent_instruction for {self.agent_name}")
            return scope_limited_agent_instruction(
                service_name=self.agent_name,
                service_operations=self.agent_purpose,
                additional_guidelines=self.additional_guidelines + self.response_guidelines,
                include_error_handling=self.include_error_handling,
                include_date_handling=self.include_date_handling
            )


def _parse_capabilities(capabilities_raw: List[Dict[str, Any]]) -> List[AgentCapability]:
    """Parse raw capability dicts into AgentCapability objects."""
    capabilities = []
    for cap in capabilities_raw:
        capabilities.append(AgentCapability(
            title=cap.get("title", ""),
            description=cap.get("description", ""),
            items=cap.get("items", [])
        ))
    return capabilities


def load_subagent_prompt_config(
    agent_name: str,
    config_path: Optional[str] = None
) -> SubAgentPromptConfig:
    """
    Load sub-agent prompt configuration from a YAML file.

    Args:
        agent_name: Name of the agent (e.g., "argocd", "github", "jira")
        config_path: Optional custom path to the config file.
                     If not provided, searches in standard locations.

    Returns:
        SubAgentPromptConfig object with loaded configuration

    Example:
        config = load_subagent_prompt_config("argocd")
        system_instruction = config.get_system_instruction()
    """
    # Determine config file path
    yaml_path = config_path if config_path else f"prompt_config.{agent_name}_agent.yaml"
    abs_yaml_path = os.path.abspath(yaml_path)
    cwd = os.getcwd()

    logger.info(f"[{agent_name}] Loading subagent prompt config...")
    logger.info(f"[{agent_name}] Current working directory: {cwd}")
    logger.info(f"[{agent_name}] Looking for config file: {yaml_path}")
    logger.info(f"[{agent_name}] Absolute path: {abs_yaml_path}")

    if not os.path.exists(yaml_path):
        logger.warning(f"[{agent_name}] Config file NOT FOUND at: {abs_yaml_path}")
        logger.warning(f"[{agent_name}] Returning DEFAULT config (YAML file missing)")
        return _get_default_config(agent_name)

    logger.info(f"[{agent_name}] Config file FOUND at: {abs_yaml_path}")

    # Load YAML config
    try:
        with open(yaml_path, "r") as f:
            config = yaml.safe_load(f) or {}
        logger.info(f"[{agent_name}] Successfully loaded YAML config")
    except Exception as e:
        logger.error(f"[{agent_name}] Error loading prompt config: {e}")
        logger.warning(f"[{agent_name}] Returning DEFAULT config due to load error")
        return _get_default_config(agent_name)

    logger.info(f"[{agent_name}] Loaded config keys: {list(config.keys())}")
    logger.debug(f"[{agent_name}] Full config content: {config}")

    # Parse capabilities if present
    capabilities_raw = config.get("capabilities", [])
    capabilities = _parse_capabilities(capabilities_raw) if capabilities_raw else []

    return SubAgentPromptConfig(
        agent_name=config.get("agent_name", agent_name.title()),
        agent_description=config.get("agent_description", f"{agent_name.title()} Agent"),
        agent_purpose=config.get("agent_purpose", f"help users with {agent_name} operations"),
        response_guidelines=config.get("response_guidelines", []),
        additional_guidelines=config.get("additional_guidelines", []),
        important_notes=config.get("important_notes", []),
        tool_usage_guidelines=config.get("tool_usage_guidelines", {}),
        additional_sections=config.get("additional_sections", {}),
        capabilities=capabilities,
        include_error_handling=config.get("include_error_handling", True),
        include_date_handling=config.get("include_date_handling", True),
        include_human_in_loop=config.get("include_human_in_loop", False),
        include_logging_notes=config.get("include_logging_notes", False),
        response_format_instruction=config.get(
            "response_format_instruction",
            "Select status as completed if the request is complete. "
            "Select status as input_required if the input is a question to the user. "
            "Set response status to error if the input indicates an error."
        ),
        tool_working_message=config.get("tool_working_message", f"Querying {agent_name.title()}..."),
        tool_processing_message=config.get("tool_processing_message", f"Processing {agent_name.title()} data..."),
        raw_config=config
    )


def _get_default_config(agent_name: str) -> SubAgentPromptConfig:
    """Return a default configuration for an agent when no YAML is found."""
    logger.info(f"[{agent_name}] Creating DEFAULT SubAgentPromptConfig (no YAML loaded)")
    return SubAgentPromptConfig(
        agent_name=agent_name.title(),
        agent_description=f"{agent_name.title()} Agent",
        agent_purpose=f"help users with {agent_name} operations",
        response_guidelines=[],
        additional_guidelines=[],
        important_notes=[],
        tool_usage_guidelines={},
        additional_sections={},
        capabilities=[],
        include_error_handling=True,
        include_date_handling=True,
        include_human_in_loop=False,
        include_logging_notes=False,
        response_format_instruction=(
            "Select status as completed if the request is complete. "
            "Select status as input_required if the input is a question to the user. "
            "Set response status to error if the input indicates an error."
        ),
        tool_working_message=f"Querying {agent_name.title()}...",
        tool_processing_message=f"Processing {agent_name.title()} data...",
        raw_config={}
    )


# Export commonly used items
__all__ = [
    "SubAgentPromptConfig",
    "load_subagent_prompt_config",
]

