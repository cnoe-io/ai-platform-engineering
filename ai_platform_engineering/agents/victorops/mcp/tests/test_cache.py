# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for the VictorOps MCP TTL cache.

These cover behaviors the tool layer relies on:
- TTL expiry actually evicts entries.
- Namespace/org/filter-key tuples isolate cache lines (so a cached
  "ssc team list" never serves a request for "other org's team list").
- The `0` sentinel disables a cache entirely (used as a kill-switch
  via env var).
- Env vars configure the singleton TTLs at import time.
"""

import importlib
import os
from datetime import datetime, timedelta

import pytest


def _reload_cache(env_overrides: dict[str, str | None]):
    """Reload cache module with specific env vars (mirrors test_client.py)."""
    original = {}
    for key, value in env_overrides.items():
        original[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

    try:
        import mcp_victorops.utils.cache as cache_mod
        importlib.reload(cache_mod)
        return cache_mod
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class TestKeyIsolation:
    """A cached value MUST NOT serve a request with a different key tuple.

    This is the behavior the tool layer depends on for correctness across
    orgs and across teams (schedule cache).
    """

    def test_different_namespaces_do_not_alias(self):
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("team", "ssc", "TEAMS")
        c.set("user", "ssc", "USERS")
        assert c.get("team", "ssc") == "TEAMS"
        assert c.get("user", "ssc") == "USERS"

    def test_different_orgs_do_not_alias(self):
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("team", "ssc", "ssc-teams")
        c.set("team", "other", "other-teams")
        assert c.get("team", "ssc") == "ssc-teams"
        assert c.get("team", "other") == "other-teams"

    def test_different_filter_keys_do_not_alias(self):
        # Schedule cache uses (org, team) — two teams in one org must not collide.
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("schedule", "ssc", "team-A-data", filter_key="team-A")
        c.set("schedule", "ssc", "team-B-data", filter_key="team-B")
        assert c.get("schedule", "ssc", filter_key="team-A") == "team-A-data"
        assert c.get("schedule", "ssc", filter_key="team-B") == "team-B-data"

    def test_none_and_empty_string_org_share_default_bucket(self):
        # Tools pass `org_slug or "_default_"`; both must hit the same line.
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("team", "", "via-empty")
        assert c.get("team", None) == "via-empty"  # type: ignore[arg-type]


class TestTTLExpiry:
    """An entry past its TTL must be reported as a miss AND evicted."""

    def test_expired_entry_is_evicted_on_get(self):
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("ns", "org", "v")

        # Backdate the entry past its TTL.
        key = ("ns", "org", "")
        v, _ = c._store[key]
        c._store[key] = (v, datetime.now() - timedelta(seconds=120))

        assert c.get("ns", "org") is None
        assert key not in c._store, "expired entry must be removed from store"


class TestDisable:
    """ttl_seconds=0 must be a complete kill-switch (used as env var off-switch)."""

    def test_zero_ttl_drops_writes_and_returns_none(self):
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=0)
        c.set("ns", "org", "v")
        assert c.get("ns", "org") is None


class TestInvalidate:
    def test_invalidate_namespace_drops_all_orgs_in_namespace(self):
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("team", "ssc", "T1")
        c.set("team", "other", "T2")
        c.set("user", "ssc", "U")
        c.invalidate("team")
        assert c.get("team", "ssc") is None
        assert c.get("team", "other") is None
        # Other namespaces untouched.
        assert c.get("user", "ssc") == "U"

    def test_invalidate_namespace_scoped_to_org_only_drops_that_org(self):
        cache_mod = _reload_cache({})
        c = cache_mod.TTLCache(ttl_seconds=60)
        c.set("team", "ssc", "ssc")
        c.set("team", "other", "other")
        c.invalidate("team", org_slug="ssc")
        assert c.get("team", "ssc") is None
        assert c.get("team", "other") == "other"


class TestEnvVarConfig:
    """The TTLs documented in README.md must match the singletons we ship."""

    def test_default_ttls_match_documented_values(self):
        cache_mod = _reload_cache({
            "VICTOROPS_CACHE_TTL_TEAMS_SECONDS": None,
            "VICTOROPS_CACHE_TTL_USERS_SECONDS": None,
            "VICTOROPS_CACHE_TTL_SCHEDULES_SECONDS": None,
        })
        assert cache_mod.team_cache()._ttl == timedelta(seconds=3600)
        assert cache_mod.user_cache()._ttl == timedelta(seconds=1800)
        assert cache_mod.schedule_cache()._ttl == timedelta(seconds=300)

    def test_env_vars_override_singleton_ttls(self):
        cache_mod = _reload_cache({
            "VICTOROPS_CACHE_TTL_TEAMS_SECONDS": "120",
            "VICTOROPS_CACHE_TTL_USERS_SECONDS": "60",
            "VICTOROPS_CACHE_TTL_SCHEDULES_SECONDS": "30",
        })
        assert cache_mod.team_cache()._ttl == timedelta(seconds=120)
        assert cache_mod.user_cache()._ttl == timedelta(seconds=60)
        assert cache_mod.schedule_cache()._ttl == timedelta(seconds=30)

    def test_zero_via_env_disables_singleton(self):
        cache_mod = _reload_cache({"VICTOROPS_CACHE_TTL_TEAMS_SECONDS": "0"})
        c = cache_mod.team_cache()
        c.set("team", "ssc", "x")
        assert c.get("team", "ssc") is None

    @pytest.mark.parametrize("bad", ["-1", "thirty", "3.5"])
    def test_invalid_env_value_fails_loud_at_import(self, bad):
        with pytest.raises(ValueError, match="non-negative"):
            _reload_cache({"VICTOROPS_CACHE_TTL_TEAMS_SECONDS": bad})
