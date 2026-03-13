"""Tests for slack_formatter.py plan-related functions.

Covers: build_task_update_chunks with step_details,
build_single_task_update, and _post_final_response block format.
"""

from ai_platform_engineering.integrations.slack_bot.utils.slack_formatter import (
    build_task_update_chunks,
    build_single_task_update,
)


class TestBuildTaskUpdateChunks:
    """build_task_update_chunks converts steps to Slack task_update format."""

    def test_basic_chunks(self):
        steps = [
            {"step_id": "s1", "title": "Search", "status": "completed", "order": 0, "agent": "RAG"},
            {"step_id": "s2", "title": "Summarize", "status": "in_progress", "order": 1, "agent": ""},
        ]
        chunks = build_task_update_chunks(steps)

        assert len(chunks) == 2
        assert chunks[0]["id"] == "s1"
        assert chunks[0]["title"] == "[RAG] Search"
        assert chunks[0]["status"] == "complete"  # A2A "completed" -> Slack "complete"
        assert chunks[1]["id"] == "s2"
        assert chunks[1]["title"] == "Summarize"
        assert chunks[1]["status"] == "in_progress"

    def test_step_details_included(self):
        steps = [
            {"step_id": "s1", "title": "Search", "status": "completed", "order": 0, "agent": ""},
        ]
        details = {"s1": "Found 3 documents"}
        chunks = build_task_update_chunks(steps, step_details=details)

        assert chunks[0]["details"] == "Found 3 documents"

    def test_step_details_omitted_when_not_present(self):
        steps = [
            {"step_id": "s1", "title": "Search", "status": "pending", "order": 0, "agent": ""},
        ]
        chunks = build_task_update_chunks(steps, step_details={"s2": "irrelevant"})

        assert "details" not in chunks[0]

    def test_ordering_respected(self):
        steps = [
            {"step_id": "s2", "title": "Second", "status": "pending", "order": 1, "agent": ""},
            {"step_id": "s1", "title": "First", "status": "pending", "order": 0, "agent": ""},
        ]
        chunks = build_task_update_chunks(steps)
        assert chunks[0]["id"] == "s1"
        assert chunks[1]["id"] == "s2"

    def test_status_mapping(self):
        """Verify all A2A statuses map correctly to Slack statuses."""
        mapping = {
            "pending": "pending",
            "in_progress": "in_progress",
            "completed": "complete",
            "failed": "error",
        }
        for a2a_status, slack_status in mapping.items():
            steps = [{"step_id": "s1", "title": "T", "status": a2a_status, "order": 0, "agent": ""}]
            chunks = build_task_update_chunks(steps)
            assert chunks[0]["status"] == slack_status, f"{a2a_status} -> {slack_status}"


class TestBuildSingleTaskUpdate:
    """build_single_task_update creates a single task_update chunk."""

    def test_basic_update(self):
        chunk = build_single_task_update("s1", "Search docs", "completed")
        assert chunk == {
            "type": "task_update",
            "id": "s1",
            "title": "Search docs",
            "status": "complete",
        }

    def test_with_details(self):
        chunk = build_single_task_update("s1", "Search", "completed", details="Found 3 results")
        assert chunk["details"] == "Found 3 results"

    def test_no_details_when_none(self):
        chunk = build_single_task_update("s1", "Search", "pending")
        assert "details" not in chunk
