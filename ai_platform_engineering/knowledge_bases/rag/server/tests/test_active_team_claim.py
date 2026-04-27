"""Tests for ``extract_active_team_from_claims`` (Spec 104).

The RAG server reads the signed ``active_team`` JWT claim instead of the
legacy ``X-Team-Id`` header. The extractor must:

1. Return ``None`` when the claim is missing, empty, or non-string.
2. Return the trimmed slug for normal team values.
3. Round-trip the ``"__personal__"`` sentinel literally — downstream
   callers translate that into "no team scope" / "personal mode".
"""

from __future__ import annotations

from server.rbac import extract_active_team_from_claims


class TestExtractActiveTeamFromClaims:
    def test_missing_claim_returns_none(self):
        assert extract_active_team_from_claims({"sub": "u1"}) is None

    def test_empty_string_returns_none(self):
        assert extract_active_team_from_claims({"active_team": ""}) is None

    def test_whitespace_only_returns_none(self):
        assert extract_active_team_from_claims({"active_team": "   "}) is None

    def test_non_string_returns_none(self):
        assert extract_active_team_from_claims({"active_team": 42}) is None
        assert extract_active_team_from_claims({"active_team": ["a"]}) is None

    def test_personal_marker_is_preserved(self):
        # The literal sentinel must round-trip; downstream code (CEL,
        # `_kb_cel_context`, `check_kb_datasource_access`) keys off the
        # exact string ``__personal__`` to skip the team check.
        assert (
            extract_active_team_from_claims({"active_team": "__personal__"})
            == "__personal__"
        )

    def test_team_slug_is_trimmed(self):
        assert (
            extract_active_team_from_claims({"active_team": "  platform-eng  "})
            == "platform-eng"
        )

    def test_normal_slug(self):
        assert (
            extract_active_team_from_claims({"active_team": "team1"}) == "team1"
        )
