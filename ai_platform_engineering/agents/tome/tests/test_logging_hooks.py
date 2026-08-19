from unittest import IsolatedAsyncioTestCase

from tome_agent.agent.loop import log_post_tool, log_pre_tool


class LoggingHookTest(IsolatedAsyncioTestCase):
    async def test_pre_tool_hook_returns_sdk_compatible_output(self) -> None:
        result = await log_pre_tool(
            {"tool_name": "Read", "tool_input": {"file_path": "overview.md"}},
            "tool-1",
            {"signal": None},
        )

        self.assertEqual(result, {})

    async def test_post_tool_hook_returns_sdk_compatible_output(self) -> None:
        result = await log_post_tool(
            {
                "tool_name": "Read",
                "result": "page contents",
                "is_error": False,
            },
            "tool-1",
            {"signal": None},
        )

        self.assertEqual(result, {})
