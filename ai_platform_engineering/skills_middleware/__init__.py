# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Skills Middleware — shared skill catalog for CAIPE supervisor and UI.

Aggregates skills from filesystem (SKILLS_DIR), MongoDB agent_configs,
and registered GitHub hubs.  Applies deterministic precedence
(default > agent_config > hub) and exposes a merged list via
``get_merged_skills()``.

The catalog also writes normalized SKILL.md files into a ``StateBackend``
so the upstream ``deepagents.middleware.skills.SkillsMiddleware`` can
inject them into the supervisor's system prompt with progressive disclosure.
"""

from ai_platform_engineering.skills_middleware.catalog import (
    get_merged_skills,
    invalidate_skills_cache,
)
from ai_platform_engineering.skills_middleware.backend_sync import (
    build_skills_files,
)

__all__ = [
    "get_merged_skills",
    "invalidate_skills_cache",
    "build_skills_files",
]
