"""Tests for slack_formatter.py task formatting functions.

Covers: build_single_task_update, build_plan_update, build_todo_task_updates,
STATUS_TO_SLACK mapping, and output/details truncation.
"""

from ai_platform_engineering.integrations.slack_bot.utils.slack_formatter import (
  build_single_task_update,
  build_plan_update,
  build_todo_task_updates,
  STATUS_TO_SLACK,
)


class TestStatusMapping:
  """STATUS_TO_SLACK maps backend statuses to Slack task_update statuses."""

  def test_all_statuses(self):
    assert STATUS_TO_SLACK == {
      "pending": "pending",
      "in_progress": "in_progress",
      "completed": "complete",
      "failed": "error",
    }

  def test_unknown_status_defaults_to_pending(self):
    chunk = build_single_task_update("s1", "T", "unknown_status")
    assert chunk["status"] == "pending"


class TestBuildSingleTaskUpdate:
  """build_single_task_update creates a single task_update chunk."""

  def test_basic(self):
    chunk = build_single_task_update("s1", "Search docs", "completed")
    assert chunk == {
      "type": "task_update",
      "id": "s1",
      "title": "Search docs",
      "status": "complete",
    }

  def test_with_details(self):
    chunk = build_single_task_update("s1", "Search", "in_progress", details="Looking...")
    assert chunk["details"] == "Looking..."

  def test_with_output(self):
    chunk = build_single_task_update("s1", "Search", "completed", output="Found 3 docs")
    assert chunk["output"] == "Found 3 docs"

  def test_with_details_and_output(self):
    chunk = build_single_task_update("s1", "S", "completed", details="Why", output="What")
    assert chunk["details"] == "Why"
    assert chunk["output"] == "What"

  def test_no_details_when_none(self):
    chunk = build_single_task_update("s1", "Search", "pending")
    assert "details" not in chunk
    assert "output" not in chunk

  def test_details_truncated_at_250(self):
    long_text = "x" * 300
    chunk = build_single_task_update("s1", "T", "completed", details=long_text)
    assert len(chunk["details"]) == 250

  def test_output_truncated_at_250(self):
    long_text = "x" * 300
    chunk = build_single_task_update("s1", "T", "completed", output=long_text)
    assert len(chunk["output"]) == 250

  def test_title_truncated_at_250(self):
    long_title = "x" * 300
    chunk = build_single_task_update("s1", long_title, "pending")
    assert len(chunk["title"]) == 250


class TestBuildPlanUpdate:
  """build_plan_update creates a plan_update chunk."""

  def test_basic(self):
    chunk = build_plan_update("Investigating the issue")
    assert chunk == {"type": "plan_update", "title": "Investigating the issue"}

  def test_truncated_at_250(self):
    chunk = build_plan_update("x" * 300)
    assert len(chunk["title"]) == 250


class TestBuildTodoTaskUpdates:
  """build_todo_task_updates converts todo items to task_update chunks."""

  def test_basic(self):
    todos = [
      {"id": 1, "content": "Research issue", "status": "completed"},
      {"id": 2, "content": "Create fix", "status": "in_progress"},
      {"id": 3, "content": "Summarize", "status": "pending"},
    ]
    chunks = build_todo_task_updates(todos)
    assert len(chunks) == 3
    assert chunks[0]["id"] == "todo_1"
    assert chunks[0]["title"] == "Research issue"
    assert chunks[0]["status"] == "complete"
    assert chunks[1]["id"] == "todo_2"
    assert chunks[1]["status"] == "in_progress"
    assert chunks[2]["id"] == "todo_3"
    assert chunks[2]["status"] == "pending"

  def test_with_details_and_outputs(self):
    todos = [{"id": 1, "content": "Research", "status": "in_progress"}]
    details = {1: "Searching knowledge base..."}
    outputs = {1: "Found 3 relevant docs"}
    chunks = build_todo_task_updates(todos, todo_details=details, todo_outputs=outputs)
    assert chunks[0]["details"] == "Searching knowledge base..."
    assert chunks[0]["output"] == "Found 3 relevant docs"

  def test_missing_details_not_included(self):
    todos = [{"id": 1, "content": "Research", "status": "pending"}]
    chunks = build_todo_task_updates(todos, todo_details={2: "irrelevant"})
    assert "details" not in chunks[0]

  def test_empty_todos(self):
    assert build_todo_task_updates([]) == []
