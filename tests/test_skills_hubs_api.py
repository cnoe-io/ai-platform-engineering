# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Integration tests for the skill hubs CRUD API and authorization.

These tests validate:
- Hub CRUD lifecycle (create, list, update, delete)
- 403 enforcement for non-admin users
- 409 on duplicate location
- 404 on missing hub

Run with: PYTHONPATH=. uv run pytest tests/test_skills_hubs_api.py -v

NOTE: These test the Python catalog + hubs admin API, NOT the Next.js API
routes (which require a running Next.js server). The Python middleware no
longer crawls GitHub/GitLab itself — that lives in the Next.js UI; the
catalog read path here is Mongo-only. For the FastAPI /skills endpoint
tests, see test_skills_router below.
"""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))


# ---------------------------------------------------------------------------
# FastAPI router tests (skill catalog + refresh)
# ---------------------------------------------------------------------------


class TestSkillsRouter:
    """Tests for the FastAPI /skills and /skills/refresh endpoints."""

    @pytest.fixture
    def client(self):
        """Create a test client for the FastAPI app with skills router."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from ai_platform_engineering.skills_middleware.router import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_get_skills_returns_catalog(self, client):
        """GET /skills returns merged catalog."""
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
            return_value=[
                {
                    "name": "test-skill",
                    "description": "Test",
                    "source": "default",
                    "source_id": None,
                    "content": None,
                    "metadata": {},
                }
            ],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.get_unavailable_sources",
            return_value=[],
        ):
            resp = client.get("/skills")

        assert resp.status_code == 200
        data = resp.json()
        assert "skills" in data
        assert "meta" in data
        assert data["meta"]["total"] == 1
        assert data["skills"][0]["name"] == "test-skill"

    def test_get_skills_with_include_content(self, client):
        """GET /skills?include_content=true passes flag to catalog."""
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
            return_value=[
                {
                    "name": "s1",
                    "description": "D",
                    "source": "default",
                    "source_id": None,
                    "content": "body content",
                    "metadata": {},
                }
            ],
        ) as mock_get, patch(
            "ai_platform_engineering.skills_middleware.catalog.get_unavailable_sources",
            return_value=[],
        ):
            resp = client.get("/skills?include_content=true")

        assert resp.status_code == 200
        mock_get.assert_called_once_with(include_content=True)

    def test_get_skills_503_on_failure(self, client):
        """GET /skills returns 503 when catalog fails."""
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
            side_effect=RuntimeError("DB down"),
        ):
            resp = client.get("/skills")

        assert resp.status_code == 503
        data = resp.json()
        assert data["detail"]["error"] == "skills_unavailable"

    def test_post_skills_refresh(self, client):
        """POST /skills/refresh invalidates cache."""
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.invalidate_skills_cache",
        ) as mock_invalidate:
            resp = client.post("/skills/refresh")

        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        mock_invalidate.assert_called_once()

    def test_get_skills_unavailable_sources_in_meta(self, client):
        """Unavailable sources are included in meta."""
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
            return_value=[],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.get_unavailable_sources",
            return_value=["hub:broken-repo"],
        ):
            resp = client.get("/skills")

        assert resp.status_code == 200
        data = resp.json()
        assert "hub:broken-repo" in data["meta"]["unavailable_sources"]

    def test_get_skills_pagination(self, client):
        """GET /skills?page=&page_size= slices results (T063)."""
        skills_list = [
            {
                "name": f"s{i}",
                "description": "d",
                "source": "default",
                "source_id": None,
                "content": None,
                "metadata": {},
                "visibility": "global",
                "team_ids": [],
                "owner_user_id": None,
            }
            for i in range(5)
        ]
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
            return_value=skills_list,
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.get_unavailable_sources",
            return_value=[],
        ):
            resp = client.get("/skills?page=1&page_size=2")

        assert resp.status_code == 200
        data = resp.json()
        assert data["meta"]["total"] == 5
        assert len(data["skills"]) == 2
        assert data["meta"]["page"] == 1

    def test_get_skills_visibility_query(self, client):
        """GET /skills?visibility= filters entitled list (T063)."""
        skills_list = [
            {
                "name": "g",
                "description": "d",
                "source": "default",
                "source_id": None,
                "content": None,
                "metadata": {},
                "visibility": "global",
                "team_ids": [],
                "owner_user_id": None,
            },
            {
                "name": "t",
                "description": "d",
                "source": "default",
                "source_id": None,
                "content": None,
                "metadata": {},
                "visibility": "team",
                "team_ids": ["x"],
                "owner_user_id": None,
            },
        ]
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
            return_value=skills_list,
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.get_unavailable_sources",
            return_value=[],
        ):
            resp = client.get("/skills?visibility=team")

        assert resp.status_code == 200
        names = [s["name"] for s in resp.json()["skills"]]
        assert names == ["t"]

    def test_get_skills_invalid_catalog_api_key_401(self, client):
        """Invalid catalog API key returns 401 (T063)."""
        with patch.dict(os.environ, {"OIDC_ISSUER": ""}, clear=False), patch(
            "ai_platform_engineering.skills_middleware.api_keys_store.verify_catalog_api_key",
            return_value=None,
        ):
            resp = client.get(
                "/skills",
                headers={"X-Caipe-Catalog-Key": "sk_test.invalid"},
            )
        assert resp.status_code == 401

    # -------------------------------------------------------------------
    # ``detect_hub_provider_from_url`` unit tests — pin the host
    # allow-list rules. The Python router used to call this helper from
    # the now-deleted ``POST /skill-hubs/crawl`` endpoint; the helper
    # itself is kept (and tested) because it gives Python parity with
    # the JS twin in ``ui/src/app/api/skill-hubs/_lib/normalize.ts``
    # and is reusable by any future Python caller that needs to tell
    # GitHub from GitLab from a URL.
    # -------------------------------------------------------------------

    def test_detect_provider_recognizes_github_com(self):
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("https://github.com/owner/repo") == "github"

    def test_detect_provider_recognizes_gitlab_com(self):
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("https://gitlab.com/group/project") == "gitlab"

    def test_detect_provider_recognizes_gitlab_subgroup_url(self):
        """The screenshot URL specifically — pin it as a regression."""
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert (
            detect_hub_provider_from_url("https://gitlab.com/gitlab-org/ai/skills")
            == "gitlab"
        )

    def test_detect_provider_returns_none_for_owner_repo(self):
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("owner/repo") is None
        assert detect_hub_provider_from_url("group/sub/project") is None

    def test_detect_provider_returns_none_for_empty(self):
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("") is None
        assert detect_hub_provider_from_url("   ") is None

    def test_detect_provider_rejects_evil_github_substring(self):
        """Hostname-bypass attempt: ``evil-github.com`` must NOT be classified
        as github. This is the same security property that
        ``isGitHubHost`` enforces in the JS twin (no substring match).
        """
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("https://evil-github.com/owner/repo") is None

    def test_detect_provider_rejects_github_com_suffix_attack(self):
        """Suffix attack: ``github.com.attacker.com`` must NOT be github."""
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert (
            detect_hub_provider_from_url("https://github.com.attacker.com/owner/repo")
            is None
        )

    def test_detect_provider_rejects_evil_gitlab_substring(self):
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("https://evil-gitlab.com/group/project") is None

    def test_detect_provider_rejects_non_http_scheme(self):
        """Non-http(s) URLs should be ignored — file://, ssh://, etc.

        SSH-style git URLs like ``git@github.com:owner/repo.git`` aren't
        valid URL schemes from urlparse's perspective and end up as
        ``None`` either way; this case pins the explicit scheme guard
        so future urlparse changes don't accidentally let
        ``ssh://github.com/...`` through.
        """
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        assert detect_hub_provider_from_url("ssh://github.com/owner/repo") is None
        assert detect_hub_provider_from_url("file:///etc/passwd") is None

    def test_detect_provider_recognizes_self_hosted_gitlab(self):
        """When ``GITLAB_API_URL`` is set, that host counts as gitlab."""
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        with patch.dict(os.environ, {"GITLAB_API_URL": "https://gitlab.mycorp.com/api/v4"}):
            assert (
                detect_hub_provider_from_url("https://gitlab.mycorp.com/group/project")
                == "gitlab"
            )

    def test_detect_provider_self_hosted_gitlab_subdomains(self):
        """Subdomains of the configured self-hosted GitLab host also match."""
        from ai_platform_engineering.skills_middleware.router import (
            detect_hub_provider_from_url,
        )
        with patch.dict(os.environ, {"GITLAB_API_URL": "https://gitlab.mycorp.com"}):
            assert (
                detect_hub_provider_from_url("https://review.gitlab.mycorp.com/group/project")
                == "gitlab"
            )

    def test_supervisor_skills_status_includes_sync(self, client):
        """GET /internal/supervisor/skills-status exposes sync_status (T067)."""
        mas = MagicMock()
        mas.get_skills_status.return_value = {
            "graph_generation": 1,
            "skills_loaded_count": 2,
            "skills_merged_at": "2026-01-01T00:00:00Z",
            "catalog_cache_generation": 3,
            "last_built_catalog_generation": 2,
            "sync_status": "supervisor_stale",
        }
        with patch(
            "ai_platform_engineering.skills_middleware.mas_registry.get_mas_instance",
            return_value=mas,
        ):
            resp = client.get("/internal/supervisor/skills-status")

        assert resp.status_code == 200
        body = resp.json()
        assert body["sync_status"] == "supervisor_stale"
        assert body["mas_registered"] is True


# ---------------------------------------------------------------------------
# Hub catalog reader (Mongo ``hub_skills`` cache)
# ---------------------------------------------------------------------------
#
# These cover the Mongo-backed ``_load_hub_skills`` implementation that
# replaced the GitHub round-trip in ``catalog.py``. The Python middleware
# no longer ships a GitHub crawler at all — the Next.js UI's
# ``ui/src/lib/hub-crawl.ts`` is the single source of truth and writes
# results into the ``hub_skills`` collection that this reader consumes.


def _make_mongo_stub(hubs, hub_skills_rows):
    """Build a minimal ``client[db]`` stub returning the given fixtures.

    Returns a tuple of ``(client, hubs_collection, hub_skills_collection)``
    so individual tests can assert against `find` calls if needed.
    """
    hubs_col = MagicMock()
    hubs_col.find.return_value.sort.return_value = list(hubs)

    hub_skills_col = MagicMock()
    hub_skills_col.find.return_value = list(hub_skills_rows)

    db = MagicMock()
    db.__getitem__.side_effect = lambda key: {
        "skill_hubs": hubs_col,
        "hub_skills": hub_skills_col,
    }[key]

    client = MagicMock()
    client.__getitem__.return_value = db
    return client, hubs_col, hub_skills_col


class TestLoadHubSkillsFromMongo:
    """``catalog._load_hub_skills`` reads from MongoDB ``hub_skills``."""

    def setup_method(self):
        from ai_platform_engineering.skills_middleware.catalog import (
            invalidate_skills_cache,
        )

        invalidate_skills_cache()

    def test_loads_github_and_gitlab_uniformly(self):
        """Hub type is irrelevant — GitHub and GitLab rows merge identically."""
        from ai_platform_engineering.skills_middleware.catalog import _load_hub_skills

        hubs = [
            {"_id": "h1", "id": "h1", "type": "github", "location": "org/gh-repo", "labels": ["sec"]},
            {"_id": "h2", "id": "h2", "type": "gitlab", "location": "mycorp/gl-repo", "labels": []},
        ]
        # ``scan_status: passed`` mirrors what the UI scanner stamps
        # onto every cached row when the optional skill-scanner is
        # configured. Under the default warn gate ``$ne: "flagged"``
        # would already accept these rows, but pinning ``passed``
        # exercises the strict-gate path too.
        rows = [
            {
                "hub_id": "h1",
                "skill_id": "ghskill",
                "name": "ghskill",
                "description": "From GitHub",
                "content": "# gh",
                "metadata": {"category": "ops"},
                "path": "skills/ghskill/SKILL.md",
                "ancillary_files": {"helper.sh": "echo hi"},
                "scan_status": "passed",
            },
            {
                "hub_id": "h2",
                "skill_id": "glskill",
                "name": "glskill",
                "description": "From GitLab",
                "content": "# gl",
                "metadata": {},
                "path": "skills/glskill/SKILL.md",
                "ancillary_files": {},
                "scan_status": "passed",
            },
        ]
        client, _, _ = _make_mongo_stub(hubs, rows)

        with patch(
            "ai_platform_engineering.utils.mongodb_client.get_mongodb_client",
            return_value=client,
        ):
            skills = _load_hub_skills(include_content=True)

        assert {s["source_id"] for s in skills} == {"h1", "h2"}
        gh = next(s for s in skills if s["source_id"] == "h1")
        gl = next(s for s in skills if s["source_id"] == "h2")
        # Both hub types produce uniformly-shaped catalog rows.
        assert gh["source"] == gl["source"] == "hub"
        assert gh["visibility"] == gl["visibility"] == "global"
        assert gh["team_ids"] == gl["team_ids"] == []
        assert gh["owner_user_id"] is None and gl["owner_user_id"] is None
        # Hub-level context is stamped onto metadata.
        assert gh["metadata"]["hub_type"] == "github"
        assert gl["metadata"]["hub_type"] == "gitlab"
        assert gh["metadata"]["hub_location"] == "org/gh-repo"
        # Hub labels merge into metadata.tags so the supervisor catalog
        # matches the UI's tag surface.
        assert "sec" in gh["metadata"]["tags"]
        # Ancillary files are forwarded so SkillsMiddleware can materialise
        # them into the StateBackend without any extra fetch.
        assert gh["ancillary_files"] == {"helper.sh": "echo hi"}
        # Composite id matches the UI's ``hub-<hub_id>-<skill_id>`` form so
        # dynamic_agents/services/skills.py can hit the same row.
        assert gh["id"] == "hub-h1-ghskill"

    def test_skips_blocked_scan_status(self):
        """Per-skill ``scan_status`` written by the UI scanner gates the catalog."""
        from ai_platform_engineering.skills_middleware.catalog import _load_hub_skills

        hubs = [{"_id": "h1", "id": "h1", "type": "github", "location": "o/r"}]
        rows = [
            {
                "hub_id": "h1",
                "skill_id": "ok",
                "name": "ok",
                "description": "fine",
                "content": "c",
                "metadata": {},
                "scan_status": "passed",
            },
            {
                "hub_id": "h1",
                "skill_id": "bad",
                "name": "bad",
                "description": "flagged",
                "content": "c",
                "metadata": {},
                "scan_status": "flagged",
            },
        ]
        client, _, _ = _make_mongo_stub(hubs, rows)

        # ``is_status_blocked`` returns True for "flagged" — assert that
        # the helper's contract really is what gates the catalog (so a
        # change to the policy auto-propagates here).
        from ai_platform_engineering.skills_middleware.scan_gate import is_status_blocked
        assert is_status_blocked("flagged") is True

        with patch(
            "ai_platform_engineering.utils.mongodb_client.get_mongodb_client",
            return_value=client,
        ):
            skills = _load_hub_skills(include_content=True)

        assert [s["name"] for s in skills] == ["ok"]

    def test_drops_rows_for_disabled_hubs(self):
        """A hub_skills row whose hub was disabled is excluded."""
        from ai_platform_engineering.skills_middleware.catalog import _load_hub_skills

        # Only h1 is enabled; rows reference both hubs to exercise the
        # disabled-hub filter.
        hubs = [{"_id": "h1", "id": "h1", "type": "github", "location": "o/r"}]
        rows = [
            {"hub_id": "h1", "skill_id": "live", "name": "live", "description": "x", "content": "", "metadata": {}, "scan_status": "passed"},
            {"hub_id": "h2", "skill_id": "stale", "name": "stale", "description": "x", "content": "", "metadata": {}, "scan_status": "passed"},
        ]
        client, _, _ = _make_mongo_stub(hubs, rows)

        with patch(
            "ai_platform_engineering.utils.mongodb_client.get_mongodb_client",
            return_value=client,
        ):
            skills = _load_hub_skills(include_content=True)

        assert [s["name"] for s in skills] == ["live"]

    def test_returns_empty_when_mongo_unavailable(self):
        """No Mongo client = empty catalog (graceful degradation)."""
        from ai_platform_engineering.skills_middleware.catalog import _load_hub_skills

        with patch(
            "ai_platform_engineering.utils.mongodb_client.get_mongodb_client",
            return_value=None,
        ):
            assert _load_hub_skills() == []

    def test_skips_rows_with_missing_required_fields(self):
        """Crawl bug or partial doc must not poison the catalog."""
        from ai_platform_engineering.skills_middleware.catalog import _load_hub_skills

        hubs = [{"_id": "h1", "id": "h1", "type": "github", "location": "o/r"}]
        rows = [
            {"hub_id": "h1", "skill_id": "ok", "name": "ok", "description": "yes", "content": "", "metadata": {}, "scan_status": "passed"},
            {"hub_id": "h1", "skill_id": "no-name", "description": "missing name", "content": "", "scan_status": "passed"},
            {"hub_id": "h1", "skill_id": "no-desc", "name": "no-desc", "content": "", "scan_status": "passed"},
        ]
        client, _, _ = _make_mongo_stub(hubs, rows)

        with patch(
            "ai_platform_engineering.utils.mongodb_client.get_mongodb_client",
            return_value=client,
        ):
            skills = _load_hub_skills(include_content=True)

        assert [s["name"] for s in skills] == ["ok"]


# ---------------------------------------------------------------------------
# Catalog hub integration (mocked MongoDB)
# ---------------------------------------------------------------------------


class TestCatalogHubIntegration:
    """Test catalog integration with hubs using mocked MongoDB."""

    def setup_method(self):
        from ai_platform_engineering.skills_middleware.catalog import (
            invalidate_skills_cache,
        )

        invalidate_skills_cache()

    def test_catalog_includes_hub_skills(self):
        """Catalog merges hub skills into the result."""
        hub_skills = [
            {
                "name": "hub-skill-1",
                "description": "From hub",
                "source": "hub",
                "source_id": "org/repo",
                "content": "# Hub Skill",
                "metadata": {},
            }
        ]

        with patch(
            "ai_platform_engineering.skills_middleware.catalog.load_default_skills",
            return_value=[],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.load_agent_skills",
            return_value=[],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog._load_hub_skills",
            return_value=hub_skills,
        ):
            from ai_platform_engineering.skills_middleware.catalog import (
                get_merged_skills,
            )

            skills = get_merged_skills(include_content=True)

        assert len(skills) == 1
        assert skills[0]["source"] == "hub"
        assert skills[0]["name"] == "hub-skill-1"

    def test_catalog_default_wins_over_hub_duplicate(self):
        """Default skill wins over hub skill with same name."""
        default_skills = [
            {
                "name": "shared-skill",
                "description": "Default version",
                "source": "default",
                "source_id": None,
                "content": "# Default",
                "metadata": {},
            }
        ]
        hub_skills = [
            {
                "name": "shared-skill",
                "description": "Hub version",
                "source": "hub",
                "source_id": "org/repo",
                "content": "# Hub",
                "metadata": {},
            }
        ]

        with patch(
            "ai_platform_engineering.skills_middleware.catalog.load_default_skills",
            return_value=default_skills,
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.load_agent_skills",
            return_value=[],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog._load_hub_skills",
            return_value=hub_skills,
        ):
            from ai_platform_engineering.skills_middleware.catalog import (
                get_merged_skills,
            )

            skills = get_merged_skills(include_content=True)

        assert len(skills) == 1
        assert skills[0]["description"] == "Default version"

    def test_hub_failure_does_not_break_catalog(self):
        """Hub fetch failure doesn't prevent default skills from loading."""
        with patch(
            "ai_platform_engineering.skills_middleware.catalog.load_default_skills",
            return_value=[
                {
                    "name": "ok-skill",
                    "description": "Still works",
                    "source": "default",
                    "source_id": None,
                    "content": "c",
                    "metadata": {},
                }
            ],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog.load_agent_skills",
            return_value=[],
        ), patch(
            "ai_platform_engineering.skills_middleware.catalog._load_hub_skills",
            side_effect=RuntimeError("Hub fetch exploded"),
        ):
            from ai_platform_engineering.skills_middleware.catalog import (
                get_merged_skills,
            )

            # _load_hub_skills is called inside get_merged_skills,
            # but the catalog catches exceptions from loaders
            # If the catalog doesn't catch, this test reveals the issue
            try:
                skills = get_merged_skills(include_content=True)
                # If it catches gracefully, we still have the default skill
                assert len(skills) >= 1
            except RuntimeError:
                # If the catalog doesn't catch hub failures, that's a bug to fix
                pytest.fail("Hub failure should not break the catalog")


# ---------------------------------------------------------------------------
# Router query param filtering & pagination tests
# ---------------------------------------------------------------------------


SAMPLE_SKILLS = [
    {
        "name": "deploy-k8s",
        "description": "Deploy to Kubernetes cluster",
        "source": "default",
        "source_id": None,
        "content": None,
        "metadata": {"tags": ["kubernetes", "deploy"]},
    },
    {
        "name": "lint-python",
        "description": "Lint Python code with ruff",
        "source": "default",
        "source_id": None,
        "content": None,
        "metadata": {"tags": ["python", "lint"]},
    },
    {
        "name": "hub-monitor",
        "description": "Monitoring alerts from hub",
        "source": "hub",
        "source_id": "org/repo",
        "content": None,
        "metadata": {"tags": ["monitoring"]},
    },
    {
        "name": "agent-test",
        "description": "Run test suite via agent config",
        "source": "agent_skills",
        "source_id": "user@co",
        "content": None,
        "metadata": {"tags": ["test", "integration"]},
    },
]


class TestSkillsRouterQueryParams:
    """Tests for GET /skills query param filtering and pagination."""

    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from ai_platform_engineering.skills_middleware.router import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def _mock_catalog(self, skills=None):
        """Return context managers that mock the catalog with sample data."""
        return (
            patch(
                "ai_platform_engineering.skills_middleware.catalog.get_merged_skills",
                return_value=skills if skills is not None else list(SAMPLE_SKILLS),
            ),
            patch(
                "ai_platform_engineering.skills_middleware.catalog.get_unavailable_sources",
                return_value=[],
            ),
        )

    # --- text search ---

    def test_q_filters_by_name(self, client):
        """GET /skills?q=deploy filters by name substring."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?q=deploy")

        assert resp.status_code == 200
        data = resp.json()
        assert data["meta"]["total"] == 1
        assert data["skills"][0]["name"] == "deploy-k8s"

    def test_q_filters_by_description(self, client):
        """GET /skills?q=ruff filters by description."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?q=ruff")

        assert resp.status_code == 200
        data = resp.json()
        assert data["meta"]["total"] == 1
        assert data["skills"][0]["name"] == "lint-python"

    def test_q_is_case_insensitive(self, client):
        """Text search is case-insensitive."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?q=KUBERNETES")

        data = resp.json()
        assert data["meta"]["total"] == 1

    # --- source filter ---

    def test_source_filter(self, client):
        """GET /skills?source=hub returns only hub skills."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?source=hub")

        data = resp.json()
        assert data["meta"]["total"] == 1
        assert data["skills"][0]["name"] == "hub-monitor"

    def test_source_filter_no_match(self, client):
        """Source filter with no matches returns empty."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?source=nonexistent")

        data = resp.json()
        assert data["meta"]["total"] == 0
        assert data["skills"] == []

    # --- tag filter ---

    def test_tags_filter_single(self, client):
        """GET /skills?tags=python returns skills with that tag."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?tags=python")

        data = resp.json()
        assert data["meta"]["total"] == 1
        assert data["skills"][0]["name"] == "lint-python"

    def test_tags_filter_multiple_match_any(self, client):
        """Comma-separated tags match any (OR logic)."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?tags=monitoring,python")

        data = resp.json()
        assert data["meta"]["total"] == 2
        names = sorted(s["name"] for s in data["skills"])
        assert names == ["hub-monitor", "lint-python"]

    # --- pagination ---

    def test_pagination_page_1(self, client):
        """Pagination returns first page."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?page=1&page_size=2")

        data = resp.json()
        assert len(data["skills"]) == 2
        assert data["meta"]["total"] == 4
        assert data["meta"]["page"] == 1
        assert data["meta"]["page_size"] == 2
        assert data["meta"]["has_more"] is True

    def test_pagination_page_2(self, client):
        """Pagination returns second page."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?page=2&page_size=2")

        data = resp.json()
        assert len(data["skills"]) == 2
        assert data["meta"]["page"] == 2
        assert data["meta"]["has_more"] is False

    def test_pagination_past_end(self, client):
        """Past-end page returns empty skills."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?page=99&page_size=2")

        data = resp.json()
        assert data["skills"] == []
        assert data["meta"]["total"] == 4

    def test_no_pagination_returns_all(self, client):
        """page=0 (default) returns all skills without pagination meta."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills")

        data = resp.json()
        assert len(data["skills"]) == 4
        assert data["meta"]["total"] == 4
        assert "page" not in data["meta"]
        assert "has_more" not in data["meta"]

    def test_page_size_clamped(self, client):
        """page_size is clamped to [1, 100]."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?page=1&page_size=999")

        data = resp.json()
        assert data["meta"]["page_size"] == 100

    # --- combined filters + pagination ---

    def test_filter_and_paginate(self, client):
        """Filters are applied before pagination."""
        with self._mock_catalog()[0], self._mock_catalog()[1]:
            resp = client.get("/skills?source=default&page=1&page_size=1")

        data = resp.json()
        assert len(data["skills"]) == 1
        assert data["meta"]["total"] == 2  # 2 default skills
        assert data["meta"]["has_more"] is True
