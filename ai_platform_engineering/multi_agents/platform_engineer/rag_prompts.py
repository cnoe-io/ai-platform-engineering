"""
RAG (Retrieval-Augmented Generation) prompt templates for the Platform Engineer agent.

This module contains all prompts related to using the knowledge base (RAG) tools,
including search, graph database queries, and document retrieval.
"""

import os
import yaml
from typing import Dict, Any, Optional
import logging
logger = logging.getLogger(__name__)


# ============================================================================
# Load RAG Prompt Config from YAML
# ============================================================================

def _load_rag_prompt_config(config_path: str = "/app/prompt_config.rag.yaml") -> Optional[Dict[str, Any]]:
    """Load RAG prompt configuration from YAML file."""
    logger.info(f"[RAG] Looking for config file: {config_path}")

    if not os.path.exists(config_path):
        logger.warning(f"[RAG] Config file NOT FOUND at: {config_path}")
        return None

    try:
        with open(config_path, "r") as f:
            config = yaml.safe_load(f) or {}
        logger.info(f"[RAG] Successfully loaded YAML config with keys: {list(config.keys())}")
        return config
    except Exception as e:
        logger.error(f"[RAG] Error loading prompt config: {e}")
        return None


_rag_prompt_config = _load_rag_prompt_config()


# ============================================================================
# RAG Prompt Components (loaded from YAML if available)
# ============================================================================

_SEARCH_TOOL_PROMPT = _rag_prompt_config.get("search_tool_prompt", "") if _rag_prompt_config else ""
_ALL_GRAPH_TOOLS_PROMPT = _rag_prompt_config.get("graph_tools_prompt", "") if _rag_prompt_config else ""
_GRAPH_RAW_QUERY_NOTES = _rag_prompt_config.get("graph_raw_query_notes", "") if _rag_prompt_config else ""
_RAG_ANSWER_FORMAT_PROMPT = _rag_prompt_config.get("answer_format_prompt", "") if _rag_prompt_config else ""
_START_RAG_PROMPT = _rag_prompt_config.get("start_rag_prompt", "") if _rag_prompt_config else ""

_RAG_ONLY_INSTRUCTIONS = f"""
{_START_RAG_PROMPT}
{_SEARCH_TOOL_PROMPT}
{_RAG_ANSWER_FORMAT_PROMPT}
"""

_RAG_WITH_GRAPH_INSTRUCTIONS = f"""
{_START_RAG_PROMPT}
{_SEARCH_TOOL_PROMPT}
**You also have access to a Graph database with structured entity relationships.**
{_ALL_GRAPH_TOOLS_PROMPT}
{_GRAPH_RAW_QUERY_NOTES}
{_RAG_ANSWER_FORMAT_PROMPT}
"""


def get_rag_instructions(rag_config: Optional[Dict[str, Any]] = None) -> str:
    """
    Get the complete RAG instructions for the Platform Engineer agent.

    Returns:
        str: Complete RAG instruction string with all prompts combined
    """

    if not rag_config:
        return "RAG tools are not available"

    graph_rag_enabled = rag_config.get("graph_rag_enabled", False)
    if graph_rag_enabled:
        logger.info(f"🔍✅ Graph RAG is enabled, returning prompt with graph RAG instructions: {_RAG_WITH_GRAPH_INSTRUCTIONS}")
        return _RAG_WITH_GRAPH_INSTRUCTIONS

    else:
        # If graph RAG is disabled, return the prompt with just the search tool instructions
        logger.info(f"🔍❌ Graph RAG is disabled, returning prompt with just the search tool instructions: {_RAG_ONLY_INSTRUCTIONS}")
        return _RAG_ONLY_INSTRUCTIONS
