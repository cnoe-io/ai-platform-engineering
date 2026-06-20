# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for the canonical webhook-task prompt templates.

Spec #099 webhook follow-up Phase 4. The templates are pure Python
strings rendered by ``get_webhook_task_template``. Tests assert on
the *structural* contract -- they do NOT lock in specific wording,
which would turn every small prompt tweak into a test churn.
Structural checks include:

* Operator parameters (repo, webex_room_ref, investigation_depth)
  actually appear in the rendered output -- regression guard against
  accidentally dropping a ``{...}`` placeholder from a template.
* The ordered step structure survives substitution.
* Invalid template_name returns an error string without raising.
* Missing/blank parameters short-circuit with a clear error message.
"""

from __future__ import annotations

import pytest

from ai_platform_engineering.multi_agents.tools import webhook_task_templates as tpl


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _render(template_name: str = "github_issue_triage", **overrides) -> str:
    args = {
        "template_name": template_name,
        "repo": "A-makarim/demo-repo",
        "webex_room_ref": "the 'auto-triage' space",
        "investigation_depth": "standard",
    }
    args.update(overrides)
    return tpl.get_webhook_task_template.invoke(args)


# ---------------------------------------------------------------------------
# Happy paths -- each template substitutes parameters and keeps its
# ordered step structure.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["github_issue_triage", "github_pr_review", "github_push_notify"]
)
def test_template_substitutes_repo_and_room(name):
    rendered = _render(template_name=name, repo="abd/demo", webex_room_ref="#ops")
    assert "abd/demo" in rendered
    # Webex room reference should appear at least once; issue_triage /
    # pr_review use it multiple times (ack + report), push_notify once.
    assert rendered.count("#ops") >= 1
    # No unresolved placeholders left behind.
    assert "{repo}" not in rendered
    assert "{webex_room_ref}" not in rendered
    assert "{preamble}" not in rendered
    assert "{investigation_depth}" not in rendered


def test_issue_triage_has_ordered_steps():
    """Issue triage is the demo-day scenario -- guard its step shape."""
    rendered = _render(template_name="github_issue_triage")
    # Explicit step headers in order. If we rename them later this
    # test changes with intent.
    for idx, marker in enumerate(["Step 1", "Step 2", "Step 3", "Step 4"], start=1):
        assert marker in rendered, f"missing {marker}"
    # Steps appear in order (Step 2's position > Step 1's, etc).
    positions = [rendered.index(f"Step {i}") for i in range(1, 5)]
    assert positions == sorted(positions)


def test_issue_triage_tells_task_to_read_payload_fields():
    """The task-runtime LLM must know to read issue.number / issue.title
    etc. from the injected Context JSON -- not ask the operator."""
    rendered = _render(template_name="github_issue_triage")
    assert "issue.number" in rendered
    assert "issue.title" in rendered
    assert "issue.html_url" in rendered


def test_issue_triage_signs_comment_as_auto_triage():
    """Demo-day readability guard: the GitHub comment should be signed
    so readers know it's automated."""
    rendered = _render(template_name="github_issue_triage")
    assert "CAIPE auto-triage" in rendered


def test_pr_review_does_not_approve_or_reject():
    """Safety guarantee: PR review template must NOT instruct the LLM
    to click approve/reject -- that's a human decision. If this
    regresses, a reviewer would be rubber-stamped by bot."""
    rendered = _render(template_name="github_pr_review")
    assert "DO NOT approve or reject" in rendered


def test_pr_review_flags_secrets():
    """Security: PR review must include 'watch for secrets in the diff'
    guidance, not just style feedback."""
    rendered = _render(template_name="github_pr_review")
    low = rendered.lower()
    assert "secret" in low or "credential" in low


def test_push_notify_is_compact_and_single_step():
    """Push events fire frequently; the template must be compact and
    NOT include a multi-step investigation workflow (contract check)."""
    rendered = _render(template_name="github_push_notify")
    # No multi-step numbered structure.
    assert "Step 2" not in rendered
    # References the field names the task will parse.
    assert "commits" in rendered
    assert "pusher" in rendered.lower() or "sender" in rendered.lower()


def test_investigation_depth_flows_into_prompt():
    for depth in ("shallow", "standard", "deep"):
        rendered = _render(investigation_depth=depth)
        assert f'"{depth}"' in rendered or depth in rendered


# ---------------------------------------------------------------------------
# Failure modes -- no raise, clear error strings.
# ---------------------------------------------------------------------------


def test_unknown_template_name_returns_error_string():
    result = tpl.get_webhook_task_template.invoke(
        {
            "template_name": "github_issue_triage",  # set valid then override after
            "repo": "a/b",
            "webex_room_ref": "#x",
        }
    )
    assert "Step 1" in result  # sanity: baseline valid call works

    # Unknown name -> error. Use .invoke so pydantic validation lets the
    # string pass (the tool itself handles validation).
    from ai_platform_engineering.multi_agents.tools.webhook_task_templates import (
        get_webhook_task_template,
    )
    # Bypass the Literal type hint by using .func directly -- same code
    # path the LLM would take if it hallucinated a template name.
    result = get_webhook_task_template.func(
        template_name="nonexistent",
        repo="a/b",
        webex_room_ref="#x",
    )
    assert "Unknown template" in result
    assert "github_issue_triage" in result  # lists available options


def test_blank_repo_returns_error_string():
    from ai_platform_engineering.multi_agents.tools.webhook_task_templates import (
        get_webhook_task_template,
    )
    result = get_webhook_task_template.func(
        template_name="github_issue_triage",
        repo="",
        webex_room_ref="#x",
    )
    assert "'repo'" in result
    assert "non-empty" in result


def test_blank_webex_room_ref_returns_error_string():
    from ai_platform_engineering.multi_agents.tools.webhook_task_templates import (
        get_webhook_task_template,
    )
    result = get_webhook_task_template.func(
        template_name="github_issue_triage",
        repo="a/b",
        webex_room_ref="",
    )
    assert "'webex_room_ref'" in result
    assert "non-empty" in result


# ---------------------------------------------------------------------------
# Metadata -- the tool must advertise itself to the LLM properly.
# ---------------------------------------------------------------------------


def test_tool_metadata_is_present():
    """LLM depends on name + description + argument schema to decide
    whether to call this tool. Regression guard: these must be populated."""
    assert tpl.get_webhook_task_template.name == "get_webhook_task_template"
    assert len(tpl.get_webhook_task_template.description) > 100
    assert "github_issue_triage" in tpl.get_webhook_task_template.description
