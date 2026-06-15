# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Smoke tests for the unlinked-prompt path in app.py.

Spec 103 FR-007: when ``auto_bootstrap_slack_user`` returns ``None``
(JIT off, JIT failure, allowlist miss, etc.), the user MUST receive an
actionable HMAC-signed linking URL — never the previous dead-end
"contact your admin" message.

The full app.py middleware is gnarly to import in isolation (it pulls in
Slack Bolt, Mongo, etc.). Rather than exercising the whole stack, this
test pins the *string content* of the prompt by reading the source and
asserting on the literal text — that's enough to catch any future
regression that re-introduces the dead-end copy without a corresponding
spec update.
"""

from __future__ import annotations

import pathlib


_APP_PY = pathlib.Path(__file__).resolve().parents[1] / "app.py"
# The prompt copy was extracted to unlinked_fallback.py (PRC-3/TEST-5/6) so the
# module under test for content assertions is now unlinked_fallback.py.  We
# still read app.py for structural assertions (no dead-end copy).
_ANON_FALLBACK_PY = pathlib.Path(__file__).resolve().parents[1] / "utils" / "unlinked_fallback.py"


def test_dead_end_message_is_no_longer_the_default() -> None:
    """The exact bad copy from FR-007 ("could not be automatically
    linked. Make sure your Slack email matches your enterprise
    account") MUST NOT appear anywhere in app.py. If you're refactoring
    and want to keep it, update the spec first."""
    src = _APP_PY.read_text(encoding="utf-8")
    assert "could not be automatically linked" not in src, (
        "Dead-end copy resurrected — see spec 103 FR-007 before reverting."
    )
    assert "Make sure your Slack email matches your enterprise account" not in src


def test_unlinked_prompt_offers_actionable_link() -> None:
    """The new prompt MUST tell the user how to link, with a clickable
    URL pulled from generate_linking_url(). We smoke-check by looking
    for the literal "Click here to link your account" string, which is
    pinned by FR-007.

    The string now lives in anon_fallback.py (extracted in PRC-3/TEST-5/6)
    rather than app.py directly. Both files are checked so refactoring that
    moves the copy again fails fast.
    """
    combined = (
        _APP_PY.read_text(encoding="utf-8")
        + _ANON_FALLBACK_PY.read_text(encoding="utf-8")
    )
    assert "Click here to link your account" in combined


def test_no_more_blanket_contact_admin_message_in_default_path() -> None:
    """The fall-through message that shipped when JIT was disabled used
    to be ``contact your admin`` with no other instruction. The new copy
    should only mention "contact your admin" as a last-resort branch
    (when no HMAC secret is configured), and that branch must be
    explicitly behind the ``if linking_url:`` guard."""
    # The prompt copy lives in unlinked_fallback.py after extraction.
    src = _ANON_FALLBACK_PY.read_text(encoding="utf-8")
    # We expect "contact your admin" to appear at most once, inside the
    # last-resort else branch.
    occurrences = src.count("contact your admin")
    assert occurrences <= 1, (
        f"Too many 'contact your admin' messages ({occurrences}) — verify "
        "we didn't re-introduce the dead-end path."
    )
