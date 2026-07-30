import json
from unittest import TestCase

from claude_agent_sdk import ToolResultBlock

from tome_agent.agent.run_stream import _tool_result_text, confluence_tree_coverage


class ConfluenceCoverageTest(TestCase):
    def test_extracts_complete_tree_coverage_from_sdk_block(self) -> None:
        payload = {
            "root_page_id": "123",
            "page_fields": ["id", "title", "parent_id", "depth", "body"],
            "pages": [
                ["123", "Platform Engineering", None, 0, "Root body"],
                ["456", "Runbook", "123", 1, "Child body"],
                ["789", "Placeholder", "123", 1, ""],
            ],
            "tree_truncated": False,
        }
        block = ToolResultBlock(
            tool_use_id="tool-1",
            content=[{"type": "text", "text": json.dumps(payload)}],
        )

        coverage = confluence_tree_coverage(
            "mcp__confluence__confluence_get_page_tree",
            block.content,
        )

        self.assertEqual(
            coverage,
            {
                "root_title": "Platform Engineering",
                "total_pages": 3,
                "pages_with_content": 2,
                "tree_truncated": False,
            },
        )

    def test_ignores_other_tools_and_malformed_results(self) -> None:
        self.assertIsNone(confluence_tree_coverage("gh.github_list_issues", "{}"))
        self.assertIsNone(
            confluence_tree_coverage(
                "mcp__confluence__confluence_get_page_tree",
                "not json",
            )
        )

    def test_normalizes_string_and_list_content(self) -> None:
        self.assertEqual(_tool_result_text("plain"), "plain")
        self.assertEqual(
            _tool_result_text(
                [
                    {"type": "text", "text": "first"},
                    {"type": "image", "data": "..."},
                    {"type": "text", "text": " second"},
                ]
            ),
            "first second",
        )
