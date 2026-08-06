import asyncio
from pathlib import Path
from unittest import TestCase

from tome_agent.agent.loop import READ_SANDBOX_OVERRIDE_MARKER, make_constrain_reads_hook


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class ConstrainReadsHookTest(TestCase):
    def setUp(self) -> None:
        self.project_dir = Path("/project/proj-1")
        self.hook = make_constrain_reads_hook(self.project_dir)

    def test_read_inside_project_dir_is_allowed_silently(self) -> None:
        result = _run(
            self.hook(
                {"tool_name": "Read", "tool_input": {"file_path": "/project/proj-1/overview.md"}},
                "id",
                {},
            )
        )
        self.assertEqual(result, {})

    def test_read_outside_project_dir_is_denied_with_override_instructions(self) -> None:
        result = _run(
            self.hook(
                {"tool_name": "Read", "tool_input": {"file_path": "/etc/passwd"}},
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "deny")
        self.assertIn(READ_SANDBOX_OVERRIDE_MARKER, output["permissionDecisionReason"])
        self.assertIn("/etc/passwd", output["permissionDecisionReason"])

    def test_marker_prefixed_path_is_allowed_and_stripped(self) -> None:
        real_path = "/home/agent/.claude/projects/x/tool-results/big.txt"
        result = _run(
            self.hook(
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": f"{READ_SANDBOX_OVERRIDE_MARKER}{real_path}"},
                },
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "allow")
        self.assertEqual(output["updatedInput"]["file_path"], real_path)

    def test_marker_works_on_glob_grep_path_key_too(self) -> None:
        real_path = "/tmp/somewhere"
        result = _run(
            self.hook(
                {
                    "tool_name": "Grep",
                    "tool_input": {"path": f"{READ_SANDBOX_OVERRIDE_MARKER}{real_path}", "pattern": "x"},
                },
                "id",
                {},
            )
        )
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "allow")
        self.assertEqual(output["updatedInput"]["path"], real_path)
        self.assertEqual(output["updatedInput"]["pattern"], "x")

    def test_glob_with_no_path_defaults_to_cwd_and_is_allowed(self) -> None:
        result = _run(
            self.hook({"tool_name": "Glob", "tool_input": {"pattern": "**/*.md"}}, "id", {})
        )
        self.assertEqual(result, {})

    def test_non_read_tool_is_ignored(self) -> None:
        result = _run(
            self.hook({"tool_name": "Bash", "tool_input": {"command": "cat /etc/passwd"}}, "id", {})
        )
        self.assertEqual(result, {})
