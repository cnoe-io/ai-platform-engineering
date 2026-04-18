# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Unit tests for skill_scanner_runner path validation."""

import pytest
from ai_platform_engineering.skills_middleware.skill_scanner_runner import (
    write_single_skill_to_temp_tree,
    write_skills_to_temp_tree,
)


class TestWriteSingleSkillToTempTree:

    def test_creates_skill_file(self):
        root = write_single_skill_to_temp_tree("my-skill", "# Hello")
        skill_file = root / "my-skill" / "SKILL.md"
        assert skill_file.exists()
        assert skill_file.read_text() == "# Hello"

    def test_sanitizes_name_with_special_chars(self):
        root = write_single_skill_to_temp_tree("My Skill!!", "# Content")
        # Special chars become dashes
        dirs = [d for d in root.iterdir() if d.is_dir()]
        assert len(dirs) == 1
        assert dirs[0].name == "my-skill"

    def test_empty_name_falls_back_to_skill(self):
        root = write_single_skill_to_temp_tree("", "# Content")
        dirs = [d for d in root.iterdir() if d.is_dir()]
        assert len(dirs) == 1
        assert dirs[0].name == "skill"

    def test_path_traversal_attempt_is_sanitized(self):
        # Regex strips all non-[a-z0-9-] chars so ../../etc/passwd → etc-passwd
        # The resulting path is always inside root — no traversal possible
        root = write_single_skill_to_temp_tree("../../etc/passwd", "# Content")
        dirs = [d for d in root.iterdir() if d.is_dir()]
        assert len(dirs) == 1
        # Confirm no traversal occurred — directory is inside root
        assert dirs[0].resolve().is_relative_to(root)

    def test_absolute_path_in_name_is_sanitized(self):
        # /etc/passwd → etc-passwd after regex sanitization
        root = write_single_skill_to_temp_tree("/etc/passwd", "# Content")
        dirs = [d for d in root.iterdir() if d.is_dir()]
        assert len(dirs) == 1
        assert dirs[0].resolve().is_relative_to(root)

    def test_content_written_correctly(self):
        content = "# My Skill\n\nThis is the skill content."
        root = write_single_skill_to_temp_tree("test-skill", content)
        skill_file = root / "test-skill" / "SKILL.md"
        assert skill_file.read_text(encoding="utf-8") == content

    def test_returns_temp_root(self):
        root = write_single_skill_to_temp_tree("valid-skill", "# Content")
        assert root.is_dir()
        # Should be inside a temp directory
        assert "config-scan-" in root.name
