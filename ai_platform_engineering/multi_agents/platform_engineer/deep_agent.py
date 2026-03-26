# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Backward-compatible re-export shim.

The canonical implementation lives in deep_agent_single.py.
This module re-exports the symbols that downstream consumers expect
(supervisor_agent.py, agent.py, agent_fix.py, test_persistence_unit.py).

Imports are lazy (via ``__getattr__``) so that merely importing this module
does **not** trigger the heavy ``deep_agent_single`` import chain, which
requires subagent packages that may not be installed in every venv.
"""

__all__ = [  # noqa: F822 — names are provided by __getattr__ (PEP 562)
    "AIPlatformEngineerMAS",
    "PlatformEngineerDeepAgent",
    "USE_STRUCTURED_RESPONSE",
]

_EXPORTED = set(__all__)


def __getattr__(name):  # PEP 562 — module-level __getattr__
    if name in _EXPORTED:
        from ai_platform_engineering.multi_agents.platform_engineer.deep_agent_single import (  # noqa: F401
            AIPlatformEngineerMAS,
            PlatformEngineerDeepAgent,
            USE_STRUCTURED_RESPONSE,
        )
        _cache = {
            "AIPlatformEngineerMAS": AIPlatformEngineerMAS,
            "PlatformEngineerDeepAgent": PlatformEngineerDeepAgent,
            "USE_STRUCTURED_RESPONSE": USE_STRUCTURED_RESPONSE,
        }
        # Populate module globals so future lookups skip __getattr__
        globals().update(_cache)
        return _cache[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
