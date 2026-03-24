"""Tests for the VictorOps MCP client org registry."""

import importlib
import json
import os

import pytest


def _reload_client(env_overrides: dict[str, str | None]):
    """Reload the client module with specific environment variables.

    Since _build_org_registry runs at import time, we need to reimport
    the module to test different configurations.
    """
    original = {}
    for key, value in env_overrides.items():
        original[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

    try:
        import mcp_victorops.api.client as client_mod
        importlib.reload(client_mod)
        return client_mod
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class TestSingleOrgFallback:
    """Test single-org configuration via legacy env vars."""

    def test_single_org_registry(self):
        client = _reload_client({
            "VICTOROPS_ORGS": None,
            "VICTOROPS_API_URL": "https://api.example.com",
            "X_VO_API_KEY": "test-key",
            "X_VO_API_ID": "test-id",
        })
        assert client.list_orgs() == ["default"]
        creds = client.get_org_credentials()
        assert creds.api_url == "https://api.example.com"
        assert creds.api_key == "test-key"
        assert creds.api_id == "test-id"

    def test_single_org_explicit_slug(self):
        client = _reload_client({
            "VICTOROPS_ORGS": None,
            "VICTOROPS_API_URL": "https://api.example.com",
            "X_VO_API_KEY": "test-key",
            "X_VO_API_ID": "test-id",
        })
        creds = client.get_org_credentials("default")
        assert creds.api_key == "test-key"

    def test_missing_api_url_raises(self):
        with pytest.raises(ValueError, match="VICTOROPS_API_URL"):
            _reload_client({
                "VICTOROPS_ORGS": None,
                "VICTOROPS_API_URL": None,
                "X_VO_API_KEY": "test-key",
                "X_VO_API_ID": "test-id",
            })

    def test_missing_api_key_raises(self):
        with pytest.raises(ValueError, match="X_VO_API_KEY"):
            _reload_client({
                "VICTOROPS_ORGS": None,
                "VICTOROPS_API_URL": "https://api.example.com",
                "X_VO_API_KEY": None,
                "X_VO_API_ID": "test-id",
            })


class TestMultiOrgRegistry:
    """Test multi-org configuration via VICTOROPS_ORGS JSON."""

    MULTI_ORG_JSON = json.dumps({
        "org-alpha": {
            "api_url": "https://alpha.example.com",
            "api_key": "key-alpha",
            "api_id": "id-alpha",
        },
        "org-beta": {
            "api_url": "https://beta.example.com",
            "api_key": "key-beta",
            "api_id": "id-beta",
        },
    })

    def test_multi_org_list(self):
        client = _reload_client({
            "VICTOROPS_ORGS": self.MULTI_ORG_JSON,
            "VICTOROPS_API_URL": None,
            "X_VO_API_KEY": None,
            "X_VO_API_ID": None,
        })
        assert sorted(client.list_orgs()) == ["org-alpha", "org-beta"]

    def test_multi_org_get_by_slug(self):
        client = _reload_client({
            "VICTOROPS_ORGS": self.MULTI_ORG_JSON,
            "VICTOROPS_API_URL": None,
            "X_VO_API_KEY": None,
            "X_VO_API_ID": None,
        })
        creds = client.get_org_credentials("org-alpha")
        assert creds.api_url == "https://alpha.example.com"
        assert creds.api_key == "key-alpha"
        assert creds.api_id == "id-alpha"

    def test_multi_org_requires_slug(self):
        client = _reload_client({
            "VICTOROPS_ORGS": self.MULTI_ORG_JSON,
            "VICTOROPS_API_URL": None,
            "X_VO_API_KEY": None,
            "X_VO_API_ID": None,
        })
        with pytest.raises(ValueError, match="Multiple VictorOps orgs"):
            client.get_org_credentials()

    def test_multi_org_unknown_slug(self):
        client = _reload_client({
            "VICTOROPS_ORGS": self.MULTI_ORG_JSON,
            "VICTOROPS_API_URL": None,
            "X_VO_API_KEY": None,
            "X_VO_API_ID": None,
        })
        with pytest.raises(ValueError, match="Unknown org_slug"):
            client.get_org_credentials("org-gamma")

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError, match="not valid JSON"):
            _reload_client({
                "VICTOROPS_ORGS": "not-json",
                "VICTOROPS_API_URL": None,
                "X_VO_API_KEY": None,
                "X_VO_API_ID": None,
            })

    def test_missing_fields_raises(self):
        bad_json = json.dumps({
            "org-bad": {"api_url": "https://example.com"},
        })
        with pytest.raises(ValueError, match="missing.*api_key"):
            _reload_client({
                "VICTOROPS_ORGS": bad_json,
                "VICTOROPS_API_URL": None,
                "X_VO_API_KEY": None,
                "X_VO_API_ID": None,
            })


class TestSingleMultiOrgAutoSelect:
    """Test that a single-entry VICTOROPS_ORGS auto-selects without slug."""

    SINGLE_ORG_JSON = json.dumps({
        "my-org": {
            "api_url": "https://myorg.example.com",
            "api_key": "key-myorg",
            "api_id": "id-myorg",
        },
    })

    def test_single_org_in_json_auto_selects(self):
        client = _reload_client({
            "VICTOROPS_ORGS": self.SINGLE_ORG_JSON,
            "VICTOROPS_API_URL": None,
            "X_VO_API_KEY": None,
            "X_VO_API_ID": None,
        })
        creds = client.get_org_credentials()
        assert creds.api_key == "key-myorg"
