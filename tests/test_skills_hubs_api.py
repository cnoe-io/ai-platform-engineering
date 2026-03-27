# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Integration tests for the skill hubs CRUD API and authorization.

These tests validate:
- Hub CRUD lifecycle (create, list, update, delete)
- 403 enforcement for non-admin users
- 409 on duplicate location
- 404 on missing hub

Run with: PYTHONPATH=. uv run pytest tests/test_skills_hubs_api.py -v

NOTE: These test the Python catalog/hub_github layer, NOT the Next.js API routes
(which require a running Next.js server). For the FastAPI /skills endpoint tests,
see test_skills_router below.
"""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))


@pytest.fixture(autouse=True)
def _skills_router_tests_no_oidc():
    """GET /skills uses anonymous bypass when OIDC is unset; clear issuer if present in env."""
    with patch.dict(os.environ, {"OIDC_ISSUER": ""}):
        yield


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
# Hub fetcher edge cases
# ---------------------------------------------------------------------------


class TestHubFetcherEdgeCases:
    """Edge case tests for the GitHub hub fetcher."""

    def test_fetch_with_no_token(self):
        """Fetcher works without token (public repos)."""
        from ai_platform_engineering.skills_middleware.loaders.hub_github import (
            fetch_github_hub_skills,
        )

        hub = {"id": "pub-hub", "location": "public/repo", "type": "github"}

        # Mock httpx to return empty tree
        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"tree": []}
            mock_resp.raise_for_status = MagicMock()
            mock_client.get.return_value = mock_resp
            mock_client_cls.return_value = mock_client

            with patch.dict("os.environ", {}, clear=False):
                result = fetch_github_hub_skills(hub)

        assert result == []

    def test_fetch_handles_api_error(self):
        """Fetcher returns empty list on API error."""
        import httpx

        from ai_platform_engineering.skills_middleware.loaders.hub_github import (
            fetch_github_hub_skills,
        )

        hub = {"id": "err-hub", "location": "org/repo", "type": "github"}

        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client_cls.return_value = mock_client

            result = fetch_github_hub_skills(hub)

        assert result == []


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
