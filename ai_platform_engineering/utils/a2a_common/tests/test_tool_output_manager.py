"""Tests for ToolOutputManager."""

import pytest
from ai_platform_engineering.utils.a2a_common.tool_output_manager import (
    ToolOutputManager,
    get_tool_output_manager,
)


@pytest.fixture
def manager():
    """Create a fresh ToolOutputManager instance for each test."""
    return ToolOutputManager()


@pytest.fixture
def sample_data():
    """Sample data for testing."""
    return """line 1: This is a test
line 2: ERROR: Something went wrong
line 3: Another line
line 4: error: lowercase error
line 5: All is well
line 6: WARNING: Check this
line 7: ERROR: Another error
line 8: Normal line
line 9: debug info
line 10: ERROR: Third error"""


class TestToolOutputManager:
    """Tests for ToolOutputManager class."""

    def test_should_truncate_small_output(self, manager):
        """Test that small outputs are not truncated."""
        small_output = "This is a small output"
        assert not manager.should_truncate(small_output)

    def test_should_truncate_large_output(self, manager):
        """Test that large outputs are truncated."""
        large_output = "x" * (manager.max_chars + 1)
        assert manager.should_truncate(large_output)

    def test_process_small_output(self, manager):
        """Test processing of small output (no truncation)."""
        small_output = {"key": "value"}
        result = manager.process_tool_output(
            output=small_output,
            tool_name="test_tool",
            context_id="test-context-123",
            agent_name="test_agent",
        )

        assert result["truncated"] is False
        assert result["output"] == small_output
        assert "char_count" in result

    def test_process_large_output(self, manager):
        """Test processing of large output (with truncation)."""
        large_output = "x" * (manager.max_chars + 1)
        result = manager.process_tool_output(
            output=large_output,
            tool_name="test_tool",
            context_id="test-context-123",
            agent_name="test_agent",
        )

        assert result["truncated"] is True
        assert "summary" in result
        assert "file_id" in result
        assert "note" in result
        assert result["char_count"] > manager.max_chars

        # Verify file was stored
        file_id = result["file_id"]
        assert file_id in manager._virtual_files

    def test_read_virtual_file(self, manager):
        """Test reading a virtual file."""
        content = "This is test content with some data"
        file_id = "test_file_id"

        # Store content
        manager._virtual_files[file_id] = content

        # Read it back
        result = manager.read_virtual_file(file_id)

        assert result["content"] == content
        assert result["total_chars"] == len(content)
        assert result["has_more"] is False

    def test_read_virtual_file_pagination(self, manager):
        """Test reading a virtual file with pagination."""
        content = "x" * 20000  # 20K chars
        file_id = "test_file_id"

        # Store content
        manager._virtual_files[file_id] = content

        # Read first chunk
        result1 = manager.read_virtual_file(file_id, start_char=0, max_chars=10000)
        assert result1["start_char"] == 0
        assert result1["end_char"] == 10000
        assert result1["has_more"] is True
        assert len(result1["content"]) > 10000  # Includes continuation message

        # Read second chunk
        result2 = manager.read_virtual_file(file_id, start_char=10000, max_chars=10000)
        assert result2["start_char"] == 10000
        assert result2["end_char"] == 20000
        assert result2["has_more"] is False

    def test_read_nonexistent_virtual_file(self, manager):
        """Test reading a virtual file that doesn't exist."""
        result = manager.read_virtual_file("nonexistent_file_id")

        assert "Error" in result["content"]
        assert result["total_chars"] == 0
        assert result["has_more"] is False

    def test_list_virtual_files(self, manager):
        """Test listing virtual files."""
        # Add some files
        manager._virtual_files["file1"] = "content1"
        manager._virtual_files["file2"] = "longer_content_here"

        result = manager.list_virtual_files()

        assert "file1" in result
        assert "file2" in result
        assert result["file1"] == len("content1")
        assert result["file2"] == len("longer_content_here")

    def test_clear_virtual_files_all(self, manager):
        """Test clearing all virtual files."""
        # Add some files
        manager._virtual_files["file1"] = "content1"
        manager._virtual_files["file2"] = "content2"

        count = manager.clear_virtual_files()

        assert count == 2
        assert len(manager._virtual_files) == 0

    def test_clear_virtual_files_by_context(self, manager):
        """Test clearing virtual files by context ID."""
        # Add files with different context IDs
        manager._virtual_files["agent_tool_ctx12345_abc"] = "content1"
        manager._virtual_files["agent_tool_ctx67890_def"] = "content2"
        manager._virtual_files["agent_tool_ctx12345_ghi"] = "content3"

        count = manager.clear_virtual_files(context_id="ctx12345-full-context-id")

        # Should remove 2 files matching "ctx12345"
        assert count == 2
        assert "agent_tool_ctx67890_def" in manager._virtual_files
        assert "agent_tool_ctx12345_abc" not in manager._virtual_files

    def test_grep_virtual_file_simple(self, manager, sample_data):
        """Test grep with simple pattern."""
        file_id = "test_file"
        manager._virtual_files[file_id] = sample_data

        result = manager.grep_virtual_file(file_id, pattern="ERROR")

        # Should match "ERROR" (case-insensitive by default) on lines 2, 4, 7, 10
        assert result["match_count"] == 4
        assert len(result["matches"]) == 4
        assert result["matches"][0]["line_number"] == 2
        assert result["matches"][1]["line_number"] == 4
        assert result["matches"][2]["line_number"] == 7
        assert result["matches"][3]["line_number"] == 10

    def test_grep_virtual_file_case_insensitive(self, manager, sample_data):
        """Test grep with case-insensitive search."""
        file_id = "test_file"
        manager._virtual_files[file_id] = sample_data

        result = manager.grep_virtual_file(
            file_id, pattern="error", case_sensitive=False
        )

        # Should match both "ERROR" and "error"
        assert result["match_count"] == 4  # lines 2, 4, 7, 10

    def test_grep_virtual_file_case_sensitive(self, manager, sample_data):
        """Test grep with case-sensitive search."""
        file_id = "test_file"
        manager._virtual_files[file_id] = sample_data

        result = manager.grep_virtual_file(
            file_id, pattern="ERROR", case_sensitive=True
        )

        # Should only match "ERROR" (not "error")
        assert result["match_count"] == 3  # lines 2, 7, 10

    def test_grep_virtual_file_regex(self, manager, sample_data):
        """Test grep with regex pattern."""
        file_id = "test_file"
        manager._virtual_files[file_id] = sample_data

        result = manager.grep_virtual_file(file_id, pattern="ERROR|WARNING")

        # Should match both ERROR and WARNING (case-insensitive)
        # Lines: 2 (ERROR), 4 (error), 6 (WARNING), 7 (ERROR), 10 (ERROR)
        assert result["match_count"] == 5

    def test_grep_virtual_file_max_results(self, manager):
        """Test grep with max_results limit."""
        file_id = "test_file"
        content = "\n".join([f"ERROR line {i}" for i in range(200)])
        manager._virtual_files[file_id] = content

        result = manager.grep_virtual_file(file_id, pattern="ERROR", max_results=50)

        assert result["match_count"] == 50
        assert result["truncated"] is True

    def test_grep_nonexistent_file(self, manager):
        """Test grep on nonexistent file."""
        result = manager.grep_virtual_file("nonexistent", pattern="test")

        assert "error" in result
        assert result["match_count"] == 0

    def test_grep_invalid_regex(self, manager, sample_data):
        """Test grep with invalid regex pattern."""
        file_id = "test_file"
        manager._virtual_files[file_id] = sample_data

        result = manager.grep_virtual_file(file_id, pattern="[invalid(")

        assert "error" in result
        assert result["match_count"] == 0

    def test_max_files_limit(self, manager):
        """Test that manager enforces max files limit."""
        # Set a small limit for testing
        manager.max_files = 3

        # Add files up to the limit
        for i in range(5):
            output = "x" * (manager.max_chars + 1)
            manager.process_tool_output(
                output=output,
                tool_name=f"tool_{i}",
                context_id=f"context_{i}",
                agent_name="test_agent",
            )

        # Should only have max_files in storage
        assert len(manager._virtual_files) <= manager.max_files

    def test_get_tool_output_manager_singleton(self):
        """Test that get_tool_output_manager returns a singleton."""
        manager1 = get_tool_output_manager()
        manager2 = get_tool_output_manager()

        assert manager1 is manager2

    def test_thread_safety(self, manager):
        """Test thread-safe access to virtual files."""
        import threading

        results = []

        def add_file(i):
            content = "x" * (manager.max_chars + 1)
            result = manager.process_tool_output(
                output=content,
                tool_name=f"tool_{i}",
                context_id=f"context_{i}",
                agent_name="test_agent",
            )
            results.append(result)

        # Create multiple threads
        threads = [threading.Thread(target=add_file, args=(i,)) for i in range(10)]

        # Start all threads
        for thread in threads:
            thread.start()

        # Wait for all to complete
        for thread in threads:
            thread.join()

        # All operations should succeed
        assert len(results) == 10
        assert all(r["truncated"] for r in results)

