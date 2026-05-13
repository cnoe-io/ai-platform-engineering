# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Canonical prompt templates for common webhook-driven autonomous tasks.

Spec #099 webhook follow-up Phase 4. When the operator asks something
like *"every time an issue is opened on my-repo, message me on Webex
and solve it"*, the supervisor's LLM needs a well-crafted prompt to
hand to ``create_autonomous_task``. Writing that prompt from scratch
every time produces inconsistent quality and routinely forgets steps
(post-to-webex-before-investigating, comment-on-issue-at-the-end,
etc).

These templates encode the institutional knowledge once and let the
LLM fetch a ready-to-customise string via the
``get_webhook_task_template`` tool. Operator parameters (repo, webex
room reference, investigation depth) are substituted at template-fetch
time so by the time it lands in ``create_autonomous_task`` there are
no placeholders left for the LLM to misinterpret.

Design principles:

* No hard-coded repo names, room IDs, or bot credentials. Everything
  operator-specific is a parameter.
* Each template explicitly tells the LLM-at-task-runtime which
  webhook payload fields to read (issue.number, issue.title, etc.)
  so the prompt works with ``Context:`` as appended by
  :func:`autonomous_agents.services.task_runner._prompt_for_publish`.
* Templates are ordered: tell the user something FIRST (fast feedback
  on Webex), investigate SECOND (can take time), report THIRD. This
  is the actual UX feedback from the spec #099 pilot round.
* Error handling guidance is baked in ("if the repo is private and
  you cannot read it, post to Webex explaining the limitation").
* Templates are Python raw-string constants so operators can read and
  tweak them via a PR without parsing Jinja or similar.
"""

from __future__ import annotations

from typing import Literal

from langchain_core.tools import tool


TemplateName = Literal[
    "github_issue_triage",
    "github_pr_review",
    "github_push_notify",
]


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

# Shared preamble describing the webhook context injection, re-used
# across every template so the LLM at task-runtime has the same mental
# model regardless of which scenario fires.
_WEBHOOK_CONTEXT_PREAMBLE = """
You are running as a scheduled autonomous task that fires when a
webhook arrives. The webhook payload from the external sender
(GitHub, in this case) is appended to this prompt under
`Context:` as JSON. Parse it to get the event details you need --
do NOT ask the operator for fields that are in the payload.

If the payload is malformed or missing required fields, post a
short error message to the Webex space ({webex_room_ref}) and
stop. Do not try to guess values.
""".strip()


GITHUB_ISSUE_TRIAGE = """
A new issue has just been opened on the GitHub repository {repo}.

{preamble}

Do the following, in this order:

Step 1 — Acknowledge on Webex (fast, synchronous):
  Post a short message to the Webex space `{webex_room_ref}` saying
  you have received the issue. Include:
    * the issue number (issue.number)
    * the issue title (issue.title)
    * a short link (issue.html_url)
    * the opener's username (issue.user.login)
    * a one-line "I am starting investigation" note
  Keep it under 5 lines -- this is a heads-up, not the full report.

Step 2 — Investigate the issue (can take a few minutes):
  Use the github sub-agent tools to gather context at depth
  "{investigation_depth}":
    * Read the issue body in full.
    * If the body references files (backticks, paths), read the
      current contents of those files at the default branch.
    * Look for recent (last 20) commits that touched files or
      directories mentioned in the issue.
    * Search closed issues in the same repo for duplicates by key
      terms from the title. Report duplicates if found.
  Build a concise understanding of: (a) what the reporter is saying,
  (b) what the code actually does around the relevant lines, (c)
  whether this is a known / previously-closed problem.

Step 3 — Report to Webex (the useful summary):
  Post a second message to `{webex_room_ref}` with:
    * Your working understanding of the bug / request
    * The specific file(s) and line range(s) most relevant
    * Any duplicate / related issues found, with links
    * A proposed next action (investigate further, request info,
      or suggest a code change)
  Use Webex markdown. Keep it to 15 lines max.

Step 4 — Reply on the GitHub issue (operator-visible record):
  Post a comment on the original GitHub issue with the same summary
  from Step 3, formatted as friendly GitHub-flavoured markdown.
  Sign the comment "Posted by CAIPE auto-triage" so readers know
  this is an automated first response, not a human maintainer.

If any step fails (e.g. the repo is private and the token lacks
access), post a short explanation to `{webex_room_ref}` and stop --
do NOT try to continue downstream steps with partial information.
""".strip()


GITHUB_PR_REVIEW = """
A new pull request has just been opened on the GitHub repository
{repo}.

{preamble}

Do the following, in this order:

Step 1 — Acknowledge on Webex:
  Post to `{webex_room_ref}` with:
    * the PR number (pull_request.number)
    * the title (pull_request.title)
    * the opener (pull_request.user.login)
    * the branch info (pull_request.head.ref -> pull_request.base.ref)
    * a one-line "starting review" note
  Under 5 lines.

Step 2 — Read the diff:
  Use the github sub-agent to fetch the files changed
  (pull_request.diff_url is linked in the payload). At depth
  "{investigation_depth}":
    * Summarise what each changed file does before vs after.
    * Flag anything that looks like a breaking API change.
    * Flag anything that looks like a secret / credential added
      inline (API keys, tokens, private keys in code or config).
    * Flag anything obviously wrong at the language level (e.g.
      unhandled exceptions, resource leaks, unused imports).
  Do not pass judgement on style choices; focus on correctness and
  safety concerns.

Step 3 — Report to Webex:
  Post a review summary to `{webex_room_ref}` including:
    * High-level description of the change
    * Any red flags found (secrets, breaking APIs, obvious bugs)
    * Recommendation: "looks good", "needs changes", or "needs
      discussion" -- be specific about which.

Step 4 — Reply on the GitHub PR:
  Post a regular PR comment (not a review with approval/rejection)
  summarising your findings. Sign "Posted by CAIPE auto-review".
  DO NOT approve or reject the PR -- leave human judgement on
  merging to the maintainer.
""".strip()


GITHUB_PUSH_NOTIFY = """
A push has just landed on the GitHub repository {repo}.

{preamble}

Post ONE message to the Webex space `{webex_room_ref}` summarising:
  * the branch (ref, stripped of `refs/heads/`)
  * the pusher's username (pusher.name or sender.login)
  * the number of commits (len(commits))
  * a bulleted list of at most 5 commit summaries, each showing the
    commit's short SHA (first 7 chars), author, and the first line
    of the commit message
  * a link to the "compare" URL (compare)

Keep it compact -- this is an informational ping, not a deep
investigation. No further steps.
""".strip()


_TEMPLATES: dict[str, str] = {
    "github_issue_triage": GITHUB_ISSUE_TRIAGE,
    "github_pr_review": GITHUB_PR_REVIEW,
    "github_push_notify": GITHUB_PUSH_NOTIFY,
}


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------


@tool
def get_webhook_task_template(
    template_name: TemplateName,
    repo: str,
    webex_room_ref: str,
    investigation_depth: Literal["shallow", "standard", "deep"] = "standard",
) -> str:
    """Fetch a canonical webhook-driven task prompt, substituted with
    operator-specific parameters.

    Use this when the operator says something like *"every time an
    issue is opened on repo X, message me on Webex and triage it"*.
    Fetch the matching template, then hand the returned string to
    ``create_autonomous_task(prompt=...)`` as-is. The template already
    tells the task-runtime LLM which payload fields to read, what
    Webex steps to perform, and in which order.

    You may slightly customise the returned string for the operator's
    specific phrasing (e.g. adding "also mention @alice as the
    escalation contact"), but do NOT remove the structural steps --
    operators have reported in the spec #099 pilot that the ordered
    acknowledge-first-then-investigate shape is what makes the
    workflow feel responsive.

    Args:
        template_name: Which template to fetch. Options:
            * "github_issue_triage" — new issue opened -> Webex heads-up
              -> investigation -> summary on Webex -> comment on issue
            * "github_pr_review" — new PR opened -> Webex heads-up ->
              read diff -> flag risks -> comment on PR (no approve/reject)
            * "github_push_notify" — push event -> short summary to
              Webex, no investigation
        repo: The repository the task will watch, "owner/name" form.
            Included in the prompt so the task-runtime LLM knows the
            scope of its work.
        webex_room_ref: How the Webex sub-agent should identify the
            target space. Accepts either a Webex roomId (long base64
            string) or a short human reference like "the 'oncall'
            space" / "space with title 'auto-triage'". The task-runtime
            LLM will resolve it via the webex `list_rooms` tool if
            it's not already a roomId.
        investigation_depth: How hard the task should dig when
            investigating. "shallow" = just the issue/PR body.
            "standard" = + referenced files + recent commits on
            related paths. "deep" = + closed-issue dedup search,
            cross-file semantic scan. Deep runs are noticeably slower
            and use more tokens; reserve for high-stakes auto-triage.

    Returns:
        The fully-substituted prompt string, ready to pass to
        ``create_autonomous_task``. Never raises -- returns a clear
        "unknown template" error string if template_name is bad.
    """
    if template_name not in _TEMPLATES:
        return (
            f"Unknown template '{template_name}'. Available: "
            + ", ".join(sorted(_TEMPLATES.keys()))
        )
    if not repo or not isinstance(repo, str):
        return "Parameter 'repo' must be a non-empty 'owner/name' string."
    if not webex_room_ref or not isinstance(webex_room_ref, str):
        return (
            "Parameter 'webex_room_ref' must be a non-empty string "
            "(Webex roomId or a human reference the task can resolve)."
        )

    preamble = _WEBHOOK_CONTEXT_PREAMBLE.format(webex_room_ref=webex_room_ref)
    return _TEMPLATES[template_name].format(
        preamble=preamble,
        repo=repo,
        webex_room_ref=webex_room_ref,
        investigation_depth=investigation_depth,
    )
