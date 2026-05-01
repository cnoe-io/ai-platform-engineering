"""Lazy LLM provider loading to reduce baseline memory by ~200MB.

cnoe-agent-utils imports ALL installed LLM provider packages at module level
(langchain_aws, langchain_openai, langchain_anthropic, etc.), each costing
~50MB. This module blocks those imports at startup and provides
``enable_provider()`` to load them on-demand when actually needed.

IMPORTANT: This module MUST be imported before ``cnoe_agent_utils`` to take
effect. Import it at the very top of ``main.py``.

How it works:
    1. At import time, inserts ``None`` into ``sys.modules`` for all provider
       packages. Python treats this as a blocked import — ``from X import Y``
       raises ImportError.
    2. When LLMFactory's module loads, its ``try/except ImportError`` blocks
       catch the error and set ``_AVAILABLE = False`` for each provider.
    3. When ``enable_provider("aws-bedrock")`` is called, we unblock the
       module, import it, and patch LLMFactory's module-level globals so
       the provider becomes available.
"""

from __future__ import annotations

import importlib
import logging
import sys
from typing import Any

logger = logging.getLogger(__name__)

# Mapping: provider name -> list of top-level modules to block
# NOTE: langchain_anthropic cannot be blocked because `deepagents` imports it
# at module level (deepagents/graph.py:11). It's always loaded.
_PROVIDER_MODULES: dict[str, list[str]] = {
    "aws-bedrock": ["langchain_aws"],
    "openai": ["langchain_openai"],
    "azure-openai": ["langchain_openai"],
    "anthropic-claude": [],  # can't block — deepagents hard-imports it
    "google-gemini": ["langchain_google_genai"],
    "gcp-vertexai": ["langchain_google_vertexai"],
    "groq": ["langchain_groq"],
}


def _patch_aws(mod: Any) -> dict[str, Any]:
    from botocore.config import Config as BotocoreConfig

    return {
        "ChatBedrock": mod.ChatBedrock,
        "ChatBedrockConverse": mod.ChatBedrockConverse,
        "BotocoreConfig": BotocoreConfig,
        "_LANGCHAIN_AWS_AVAILABLE": True,
    }


def _patch_openai(mod: Any) -> dict[str, Any]:
    return {
        "ChatOpenAI": mod.ChatOpenAI,
        "AzureChatOpenAI": mod.AzureChatOpenAI,
        "_LANGCHAIN_OPENAI_AVAILABLE": True,
    }


def _patch_anthropic(mod: Any) -> dict[str, Any]:
    # langchain_anthropic is always loaded (deepagents imports it at module level)
    # This patch just ensures LLMFactory's flag is set correctly
    import langchain_anthropic

    return {
        "ChatAnthropic": langchain_anthropic.ChatAnthropic,
        "_LANGCHAIN_ANTHROPIC_AVAILABLE": True,
    }


def _patch_google_genai(mod: Any) -> dict[str, Any]:
    return {
        "ChatGoogleGenerativeAI": mod.ChatGoogleGenerativeAI,
        "_LANGCHAIN_GOOGLE_GENAI_AVAILABLE": True,
    }


def _patch_google_vertexai(mod: Any) -> dict[str, Any]:
    return {
        "ChatVertexAI": mod.ChatVertexAI,
        "_LANGCHAIN_GOOGLE_VERTEXAI_AVAILABLE": True,
    }


def _patch_groq(mod: Any) -> dict[str, Any]:
    return {
        "ChatGroq": mod.ChatGroq,
        "_LANGCHAIN_GROQ_AVAILABLE": True,
    }


# Mapping: provider name -> function that returns {attr: value} patches for llm_factory
_PROVIDER_PATCHES: dict[str, Any] = {
    "aws-bedrock": _patch_aws,
    "openai": _patch_openai,
    "azure-openai": _patch_openai,  # same module as openai
    "anthropic-claude": _patch_anthropic,
    "google-gemini": _patch_google_genai,
    "gcp-vertexai": _patch_google_vertexai,
    "groq": _patch_groq,
}

# Track which providers have been enabled
_enabled: set[str] = set()

# All unique module names to block
_ALL_MODULES_TO_BLOCK = {mod for mods in _PROVIDER_MODULES.values() for mod in mods}


def _block_all() -> None:
    """Block all LLM provider modules from importing."""
    for mod_name in _ALL_MODULES_TO_BLOCK:
        if mod_name not in sys.modules:
            sys.modules[mod_name] = None  # type: ignore[assignment]
    logger.debug("Blocked LLM provider imports: %s", _ALL_MODULES_TO_BLOCK)


def enable_provider(provider: str) -> None:
    """Lazily load a provider's modules and patch LLMFactory globals.

    Safe to call multiple times — subsequent calls for the same provider are no-ops.

    Args:
        provider: Provider name as used in agent config (e.g., "aws-bedrock", "openai").
    """
    if provider in _enabled:
        return

    modules = _PROVIDER_MODULES.get(provider)
    if modules is None:
        logger.warning("Unknown provider '%s' — cannot lazy-load", provider)
        return

    patch_fn = _PROVIDER_PATCHES.get(provider)
    if patch_fn is None:
        logger.warning("No patch function for provider '%s'", provider)
        return

    # Unblock and import the provider's modules
    imported_mod = None
    for mod_name in modules:
        # Remove the block (None entry) so import machinery can find the real module
        sys.modules.pop(mod_name, None)
        # Also remove any sub-modules that might have been cached as None
        to_remove = [k for k in sys.modules if k.startswith(mod_name + ".") and sys.modules[k] is None]
        for k in to_remove:
            del sys.modules[k]
        imported_mod = importlib.import_module(mod_name)

    if not modules:
        # Provider has no blockable modules (e.g., anthropic — always loaded by deepagents)
        _enabled.add(provider)
        logger.info("LLM provider '%s' already available (no lazy-loading needed)", provider)
        return

    if imported_mod is None:
        logger.error("Failed to import modules for provider '%s'", provider)
        return

    # Patch LLMFactory's module-level globals
    import cnoe_agent_utils.llm_factory as _lf

    patches = patch_fn(imported_mod)
    for attr, value in patches.items():
        setattr(_lf, attr, value)

    _enabled.add(provider)
    logger.info("Lazy-loaded LLM provider '%s' (modules: %s)", provider, modules)


# Block all providers on module import
_block_all()
