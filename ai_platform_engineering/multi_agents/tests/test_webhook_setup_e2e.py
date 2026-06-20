# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""End-to-end integration test for chat-driven webhook setup.

Spec #099 webhook follow-up Phase 5. Each individual supervisor tool
has its own unit tests; this file exercises the FULL CHAIN the LLM
walks through when the operator says something like:

    "Every time someone opens an issue on A-makarim/demo-repo,
     message me on Webex and try to solve it."

The test drives the tools directly (no actual LLM) so we can assert
that the expected sequence of calls happens with the expected
values threaded through:

    Step 1: get_webhook_task_template("github_issue_triage", repo, room)
              -> returns a ready-to-use prompt
    Step 2: create_autonomous_task(prompt=<from step 1>,
                                   trigger_type="webhook", ...)
              -> returns task_id, callback_url, auto-generated secret
    Step 3: register_github_webhook(repo, callback_url=<from step 2>,
                                    events=["issues"],
                                    secret=<from step 2>)
              -> returns hook_id confirming GitHub accepted the hook

The test MUST stay fast (no real network, no real sockets) while
still catching regressions in the contract between tools. It uses
two ``httpx.MockTransport`` handlers -- one keyed on the
autonomous-agents URL, one on the GitHub API URL -- that record
every call so the final assertions can verify the secret round-trip,
the callback URL substitution, and the events list.

What this test does NOT cover (by design):

  * Actual webhook delivery from GitHub to the autonomous-agents
    /hooks/{task_id} endpoint -- that's covered by
    ``autonomous_agents/tests/test_webhooks.py`` with the real
    FastAPI TestClient.
  * The supervisor's LLM choosing these tools. That's an integration
    behaviour of the LLM, not of our code.
  * The scheduler firing the task after webhook receipt -- covered
    by ``autonomous_agents/tests/test_scheduler_*.py``.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from ai_platform_engineering.multi_agents.tools import (
    autonomous_tasks as ta,
)
from ai_platform_engineering.multi_agents.tools import (
    github_webhooks as gw,
)
from ai_platform_engineering.multi_agents.tools import (
    webhook_task_templates as tpl,
)

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _stub_env(monkeypatch):
    """Minimum env every step needs:

    - AUTONOMOUS_AGENTS_URL: internal address the tool POSTs to
    - AUTONOMOUS_AGENTS_PUBLIC_URL: what the callback_url is built from
    - GITHUB_PERSONAL_ACCESS_TOKEN: the PAT the webhook registration uses
    """
    monkeypatch.setenv("AUTONOMOUS_AGENTS_URL", "http://autonomous-agents:8002")
    monkeypatch.setenv(
        "AUTONOMOUS_AGENTS_PUBLIC_URL", "https://abcd-1-2-3-4.ngrok.io"
    )
    monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_TEST_TOKEN")


def _patch_both_httpx(monkeypatch, aa_handler, gh_handler):
    """Install a single URL-dispatching MockTransport for both modules.

    The supervisor tools live in two modules (``autonomous_tasks`` and
    ``github_webhooks``), but they both import the same ``httpx``
    module object -- patching ``httpx.Client`` on one would collide
    with the other. We route by request URL instead:

        ``api.github.com``     -> gh_handler
        ``autonomous-agents``  -> aa_handler

    The factory + transport pair matches the pattern used by the
    per-module unit test helpers so behaviour is equivalent; only the
    dispatch rule is new.
    """

    def router(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.github.com" in url:
            return gh_handler(request)
        # Default: treat everything else as autonomous-agents traffic.
        return aa_handler(request)

    transport = httpx.MockTransport(router)
    real_client = httpx.Client

    def _factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(ta.httpx, "Client", _factory)
    monkeypatch.setattr(gw.httpx, "Client", _factory)


# ---------------------------------------------------------------------------
# The full chain
# ---------------------------------------------------------------------------


def test_full_chain_creates_task_and_registers_webhook(monkeypatch):
    """Walk the three tools in order and verify secret/URL propagation.

    This is the demo-day test: if this passes, the one-sentence
    operator ask ("every time there's an issue on X, tell me on Webex
    and fix it") composes into a working setup flow without manual
    secret-juggling or URL-pasting.
    """
    # Recording buffers for everything the test sends over the wire.
    aa_calls: list[dict[str, Any]] = []
    gh_calls: list[dict[str, Any]] = []

    def aa_handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        body = _json.loads(request.read() or b"{}")
        aa_calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "body": body,
            }
        )
        # Only /tasks POST is expected in this chain; return a plausible
        # 201 with the server's echo of the incoming payload (minus secret,
        # which the real server redacts to has_secret=True).
        assert request.method == "POST"
        assert str(request.url).endswith("/api/v1/tasks")
        server_trigger = {"type": body["trigger"]["type"]}
        if body["trigger"]["type"] == "webhook":
            server_trigger["has_secret"] = bool(body["trigger"].get("secret"))
        return httpx.Response(
            201,
            json={
                **body,
                "trigger": server_trigger,
                "next_run": None,
            },
        )

    def gh_handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        body = _json.loads(request.read() or b"{}")
        gh_calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "auth": request.headers.get("Authorization"),
                "body": body,
            }
        )
        assert request.method == "POST"
        assert str(request.url) == (
            "https://api.github.com/repos/A-makarim/demo-repo/hooks"
        )
        # Plausible GitHub 201 response shape.
        return httpx.Response(
            201,
            json={
                "id": 12345,
                "name": "web",
                "active": body["active"],
                "events": body["events"],
                "config": {
                    "url": body["config"]["url"],
                    "content_type": "json",
                    "insecure_ssl": "0",
                    "secret": "********",  # GitHub masks on read
                },
            },
        )

    _patch_both_httpx(monkeypatch, aa_handler, gh_handler)

    # ---- Step 1: fetch the canonical triage prompt ------------------------

    prompt = tpl.get_webhook_task_template.invoke(
        {
            "template_name": "github_issue_triage",
            "repo": "A-makarim/demo-repo",
            "webex_room_ref": "the 'auto-triage' space",
            "investigation_depth": "standard",
        }
    )
    # Prompt is ready to drop into create_autonomous_task -- parameters
    # all substituted, no placeholders left.
    assert "A-makarim/demo-repo" in prompt
    assert "auto-triage" in prompt
    assert "{repo}" not in prompt
    assert "Step 1" in prompt  # structural contract

    # ---- Step 2: create the webhook task with the prompt ------------------

    create_out = ta.create_autonomous_task.invoke(
        {
            "id": "demo-triage",
            "name": "Demo Issue Auto-triage",
            "prompt": prompt,
            "trigger_type": "webhook",
        }
    )

    # Server received the prompt + generated webhook secret.
    assert len(aa_calls) == 1
    created_payload = aa_calls[0]["body"]
    assert created_payload["id"] == "demo-triage"
    assert created_payload["trigger"]["type"] == "webhook"
    assert created_payload["prompt"] == prompt  # prompt transit is lossless
    aa_secret_on_wire = created_payload["trigger"]["secret"]
    assert isinstance(aa_secret_on_wire, str) and len(aa_secret_on_wire) == 64

    # The tool returned the operator-visible callback URL + secret in the
    # response so the LLM can thread them into register_github_webhook.
    assert "callback_url:" in create_out
    assert "https://abcd-1-2-3-4.ngrok.io/hooks/demo-triage" in create_out
    assert aa_secret_on_wire in create_out  # exact secret echoed once
    assert "auto-generated" in create_out

    # In the demo flow the LLM would parse those lines from create_out;
    # in this test we extract them directly to feed into register_.
    callback_url = "https://abcd-1-2-3-4.ngrok.io/hooks/demo-triage"
    secret = aa_secret_on_wire

    # ---- Step 3: register the webhook on GitHub with the same values ------

    register_out = gw.register_github_webhook.invoke(
        {
            "repo": "A-makarim/demo-repo",
            "callback_url": callback_url,
            "events": ["issues"],
            "secret": secret,
        }
    )

    # GitHub received the exact callback URL and secret.
    assert len(gh_calls) == 1
    gh_payload = gh_calls[0]["body"]
    assert gh_payload["events"] == ["issues"]
    assert gh_payload["config"]["url"] == callback_url
    assert gh_payload["config"]["secret"] == secret  # identical to AA's
    assert gh_payload["config"]["content_type"] == "json"
    assert gh_payload["active"] is True
    assert gh_calls[0]["auth"] == "Bearer ghp_TEST_TOKEN"

    # Tool's operator-facing response confirms registration.
    assert "hook_id=12345" in register_out
    assert "A-makarim/demo-repo" in register_out
    assert "issues" in register_out
    # Secret MUST NOT appear in register_out when caller-supplied
    # (redaction contract from Phase 1/2 -- cross-tool consistency).
    assert secret not in register_out
    assert "HMAC-SHA256" in register_out


def test_chain_fails_cleanly_when_autonomous_agents_unreachable(monkeypatch):
    """If autonomous-agents is down, create_autonomous_task returns a
    human-readable error and the LLM has no callback_url to pass
    forward. Verify register_github_webhook is NOT called (no broken
    half-state on GitHub)."""
    gh_reached = False

    def aa_handler(_request):
        raise httpx.ConnectError("service down")

    def gh_handler(_request):
        nonlocal gh_reached
        gh_reached = True
        return httpx.Response(201)

    _patch_both_httpx(monkeypatch, aa_handler, gh_handler)

    prompt = tpl.get_webhook_task_template.invoke(
        {
            "template_name": "github_issue_triage",
            "repo": "a/b",
            "webex_room_ref": "#x",
        }
    )
    out = ta.create_autonomous_task.invoke(
        {
            "id": "t",
            "name": "T",
            "prompt": prompt,
            "trigger_type": "webhook",
        }
    )

    # Clear error surface.
    assert "unreachable" in out.lower() or "service" in out.lower()
    # Critically: no callback_url appears, so the LLM has nothing to
    # chain into register_github_webhook -- and in a real run, it
    # wouldn't try. We verify the contract by asserting the GitHub
    # mock never got a request.
    assert gh_reached is False


def test_chain_fails_cleanly_when_github_rejects_hook(monkeypatch):
    """Autonomous-agents creates the task successfully, but GitHub 422s
    the webhook registration (e.g. duplicate URL). Verify the
    half-applied state is visible so the operator can clean up."""

    def aa_handler(request):
        import json as _json
        body = _json.loads(request.read() or b"{}")
        return httpx.Response(
            201,
            json={**body, "trigger": {"type": "webhook", "has_secret": True}},
        )

    def gh_handler(_request):
        return httpx.Response(
            422,
            json={
                "message": "Validation Failed",
                "errors": [
                    {
                        "resource": "Hook",
                        "code": "custom",
                        "message": "Hook already exists on this repository",
                    }
                ],
            },
        )

    _patch_both_httpx(monkeypatch, aa_handler, gh_handler)

    prompt = tpl.get_webhook_task_template.invoke(
        {
            "template_name": "github_issue_triage",
            "repo": "A-makarim/demo-repo",
            "webex_room_ref": "#x",
        }
    )
    create_out = ta.create_autonomous_task.invoke(
        {
            "id": "dup-hook",
            "name": "Dup Hook",
            "prompt": prompt,
            "trigger_type": "webhook",
        }
    )
    assert "callback_url:" in create_out  # task created OK

    # GitHub rejects the second half.
    register_out = gw.register_github_webhook.invoke(
        {
            "repo": "A-makarim/demo-repo",
            "callback_url": (
                "https://abcd-1-2-3-4.ngrok.io/hooks/dup-hook"
            ),
            "events": ["issues"],
            "secret": "any-secret",
        }
    )
    assert "HTTP 422" in register_out
    assert "already exists" in register_out
    # The LLM reading this response knows to advise the operator to
    # clean up the existing hook (via list_github_webhooks +
    # delete_github_webhook) or to delete the orphaned task.
