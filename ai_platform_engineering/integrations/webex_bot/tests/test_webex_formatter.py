"""Unit tests for Webex formatter utilities."""

from utils.webex_formatter import (
    WEBEX_MAX_MESSAGE_LENGTH,
    format_error_message,
    format_execution_plan,
    format_progress_message,
    format_tool_notification,
    split_long_message,
)


class TestFormatExecutionPlan:
    """Tests for format_execution_plan()."""

    def test_empty_list_returns_empty_string(self):
        assert format_execution_plan([]) == ""

    def test_single_step(self):
        steps = [{"name": "Step One", "status": "pending"}]
        result = format_execution_plan(steps)
        assert "**Execution Plan:**" in result
        assert "1. ⏳ Step One" in result

    def test_multiple_steps_with_different_statuses(self):
        steps = [
            {"name": "First", "status": "pending"},
            {"name": "Second", "status": "in_progress"},
            {"name": "Third", "status": "completed"},
            {"name": "Fourth", "status": "failed"},
            {"name": "Fifth", "status": "skipped"},
        ]
        result = format_execution_plan(steps)
        assert "1. ⏳ First" in result
        assert "2. 🔄 Second" in result
        assert "3. ✅ Third" in result
        assert "4. ❌ Fourth" in result
        assert "5. ⏭️ Fifth" in result

    def test_uses_title_when_name_missing(self):
        steps = [{"title": "Fallback Title", "status": "completed"}]
        result = format_execution_plan(steps)
        assert "1. ✅ Fallback Title" in result

    def test_fallback_to_step_number_when_no_name_or_title(self):
        steps = [{"status": "pending"}]
        result = format_execution_plan(steps)
        assert "1. ⏳ Step 1" in result

    def test_running_status_maps_to_in_progress_emoji(self):
        steps = [{"name": "Running", "status": "running"}]
        result = format_execution_plan(steps)
        assert "🔄 Running" in result


class TestFormatToolNotification:
    """Tests for format_tool_notification()."""

    def test_running_status(self):
        assert format_tool_notification("my_tool", "running") == "🔧 Calling **my_tool**..."

    def test_started_status(self):
        assert format_tool_notification("my_tool", "started") == "🔧 Calling **my_tool**..."

    def test_completed_status(self):
        assert format_tool_notification("my_tool", "completed") == "✅ **my_tool** completed"

    def test_failed_status(self):
        assert format_tool_notification("my_tool", "failed") == "❌ **my_tool** failed"

    def test_unknown_status_fallback(self):
        assert format_tool_notification("my_tool", "unknown") == "🔧 **my_tool** (unknown)"


class TestFormatProgressMessage:
    """Tests for format_progress_message()."""

    def test_empty_returns_working_on_it(self):
        assert format_progress_message() == "⏳ Working on it..."

    def test_plan_text_only(self):
        result = format_progress_message(plan_text="**Execution Plan:**\n1. ⏳ Step 1")
        assert "**Execution Plan:**" in result
        assert "1. ⏳ Step 1" in result

    def test_current_tool_only(self):
        result = format_progress_message(current_tool="🔧 Calling **tool**...")
        assert "🔧 Calling **tool**..." in result

    def test_accumulated_text_only(self):
        result = format_progress_message(accumulated_text="Some output")
        assert "---" in result
        assert "Some output" in result

    def test_accumulated_text_truncated_over_500_chars(self):
        long_text = "x" * 600
        result = format_progress_message(accumulated_text=long_text)
        assert "..." in result
        assert len(result.split("---\n")[1]) <= 503  # 500 + "..."

    def test_all_combined(self):
        result = format_progress_message(
            plan_text="Plan",
            current_tool="Tool",
            accumulated_text="Output",
        )
        assert "Plan" in result
        assert "Tool" in result
        assert "Output" in result
        assert "---" in result


class TestFormatErrorMessage:
    """Tests for format_error_message()."""

    def test_formats_error(self):
        assert format_error_message("Something went wrong") == "❌ **Error**: Something went wrong"

    def test_empty_error(self):
        assert format_error_message("") == "❌ **Error**: "


class TestSplitLongMessage:
    """Tests for split_long_message()."""

    def test_text_under_limit_returns_single_chunk(self):
        text = "Short message"
        result = split_long_message(text)
        assert result == [text]

    def test_text_at_limit_returns_single_chunk(self):
        text = "x" * WEBEX_MAX_MESSAGE_LENGTH
        result = split_long_message(text)
        assert len(result) == 1
        assert result[0] == text

    def test_text_over_limit_splits(self):
        text = "x" * (WEBEX_MAX_MESSAGE_LENGTH + 100)
        result = split_long_message(text)
        assert len(result) >= 2
        assert all(len(chunk) <= WEBEX_MAX_MESSAGE_LENGTH for chunk in result)
        assert "".join(result) == text

    def test_splits_on_paragraph_breaks(self):
        para1 = "First paragraph."
        para2 = "Second paragraph."
        gap = "\n\n"
        text = para1 + gap + para2 + "x" * (WEBEX_MAX_MESSAGE_LENGTH - len(para1) - 2)
        # Make it long enough to split
        text = text + "y" * 500
        result = split_long_message(text)
        assert len(result) >= 2

    def test_splits_on_sentence_breaks(self):
        sent1 = "First sentence. "
        sent2 = "Second sentence."
        text = sent1 * 4000 + sent2  # Over limit
        result = split_long_message(text)
        assert len(result) >= 2

    def test_custom_max_length(self):
        text = "a" * 100
        result = split_long_message(text, max_length=50)
        assert len(result) >= 2
        assert all(len(chunk) <= 50 for chunk in result)
