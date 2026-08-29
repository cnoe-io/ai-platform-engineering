from tome_agent.agent.chat import build_system_prompt
from tome_agent.agent.issue_context import format_issue_context
from tome_agent.orchestrator.contract import IssueContext, IssueContextItem, ProjectSnapshot


def _context() -> IssueContext:
    item = IssueContextItem(
        repo="example/service",
        number=42,
        title="Choose the durable cache",
        state="open",
        display_status="open",
        labels=["decision", "critical"],
        assignees=["test-user"],
        updated_at="2026-08-27T00:00:00Z",
        url="https://github.com/example/service/issues/42",
    )
    return IssueContext(
        decisions=[item],
        critical=[item],
        decision_count=25,
        critical_count=1,
        decision_truncated=True,
    )


def test_formats_bounded_issue_index_as_untrusted_evidence() -> None:
    block = format_issue_context(_context())

    assert "example/service#42" in block
    assert '<decisions total="25" truncated="true">' in block
    assert "untrusted source evidence" in block


def test_chat_prompt_receives_github_decisions_and_critical_items() -> None:
    snapshot = ProjectSnapshot(
        project_id="project-id",
        slug="example-project",
        name="Example project",
    )

    prompt = build_system_prompt(snapshot, {}, _context())

    assert "GITHUB DECISIONS AND CRITICAL ITEMS" in prompt
    assert "Choose the durable cache" in prompt
