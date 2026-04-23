"""Tests for the hybrid-ACL helper (server.doc_acl).

Spec 102 Phase 7 follow-on (RAG hybrid ACL).

These tests exercise the feature flag, tag derivation, and the
filter merge semantics — including the failure-closed behaviour
that prevents callers from widening their own ACL.
"""

from __future__ import annotations

import importlib

import pytest

from common.models.rbac import UserContext
from common.models.server import QueryRequest


def _reload_with_flag(value: str):
    """Reload server.doc_acl with RBAC_DOC_ACL_TAGS_ENABLED=<value>."""
    import os

    os.environ["RBAC_DOC_ACL_TAGS_ENABLED"] = value
    import server.doc_acl as mod

    return importlib.reload(mod)


@pytest.fixture(autouse=True)
def _restore_flag(monkeypatch):
    """Reset the env var + reload after each test so flag state never leaks."""
    yield
    monkeypatch.delenv("RBAC_DOC_ACL_TAGS_ENABLED", raising=False)
    import server.doc_acl as mod

    importlib.reload(mod)


def _user(
    email: str = "alice@example.com",
    groups: list[str] | None = None,
    realm_roles: list[str] | None = None,
) -> UserContext:
    return UserContext(
        email=email,
        groups=groups or [],
        realm_roles=realm_roles or [],
        role="user",
        is_authenticated=email != "anonymous",
    )


def _qr(filters=None) -> QueryRequest:
    return QueryRequest(query="anything", filters=filters or {})


# ---------------------------------------------------------------------------
# derive_user_acl_tags
# ---------------------------------------------------------------------------


def test_derive_returns_empty_when_flag_off():
    mod = _reload_with_flag("false")
    tags = mod.derive_user_acl_tags(_user(groups=["platform-eng"]))
    assert tags == []


def test_derive_returns_empty_for_anonymous_even_when_flag_on():
    mod = _reload_with_flag("true")
    tags = mod.derive_user_acl_tags(_user(email="anonymous"))
    assert tags == []


def test_derive_includes_public_role_and_team():
    mod = _reload_with_flag("true")
    tags = mod.derive_user_acl_tags(
        _user(
            groups=["platform-eng", "ops"],
            realm_roles=["chat_user", "kb_admin"],
        )
    )
    assert tags[0] == mod.PUBLIC_TAG
    assert "role:chat_user" in tags
    assert "role:kb_admin" in tags
    assert "team:platform-eng" in tags
    assert "team:ops" in tags


def test_derive_skips_per_kb_realm_roles():
    """``kb_reader:foo`` is datasource-level; never a tag."""
    mod = _reload_with_flag("true")
    tags = mod.derive_user_acl_tags(
        _user(realm_roles=["kb_reader:foo", "kb_admin:bar", "kb_ingestor:baz"])
    )
    assert "role:kb_reader:foo" not in tags
    assert "role:kb_admin:bar" not in tags
    assert "role:kb_ingestor:baz" not in tags


def test_derive_dedupes_and_skips_blanks():
    mod = _reload_with_flag("true")
    tags = mod.derive_user_acl_tags(
        _user(
            groups=["platform-eng", " ", "platform-eng"],
            realm_roles=["chat_user", "chat_user", ""],
        )
    )
    assert tags.count("team:platform-eng") == 1
    assert tags.count("role:chat_user") == 1
    assert "team: " not in tags  # blank-only entries dropped


# ---------------------------------------------------------------------------
# apply_doc_acl_filter — flag off / bypass principals
# ---------------------------------------------------------------------------


def test_apply_noop_when_flag_off():
    mod = _reload_with_flag("false")
    qr = _qr()
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    assert qr.filters == {}


def test_apply_noop_for_anonymous():
    mod = _reload_with_flag("true")
    qr = _qr()
    mod.apply_doc_acl_filter(qr, _user(email="anonymous"))
    assert qr.filters == {}


def test_apply_noop_for_trusted_network_principal():
    mod = _reload_with_flag("true")
    qr = _qr()
    mod.apply_doc_acl_filter(qr, _user(email="trusted-network"))
    assert qr.filters == {}


def test_apply_noop_for_trusted_prefixed_principal():
    mod = _reload_with_flag("true")
    qr = _qr()
    mod.apply_doc_acl_filter(qr, _user(email="trusted:internal"))
    assert qr.filters == {}


def test_apply_noop_for_client_credentials_principal():
    mod = _reload_with_flag("true")
    qr = _qr()
    mod.apply_doc_acl_filter(qr, _user(email="client:caipe-supervisor"))
    assert qr.filters == {}


# ---------------------------------------------------------------------------
# apply_doc_acl_filter — merge semantics
# ---------------------------------------------------------------------------


def test_apply_sets_filter_when_absent():
    mod = _reload_with_flag("true")
    qr = _qr()
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    tags = qr.filters[mod.ACL_FILTER_KEY]
    assert mod.PUBLIC_TAG in tags
    assert "team:platform-eng" in tags


def test_apply_keeps_existing_string_when_in_user_set():
    mod = _reload_with_flag("true")
    qr = _qr(filters={mod.ACL_FILTER_KEY: "team:platform-eng"})
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    assert qr.filters[mod.ACL_FILTER_KEY] == ["team:platform-eng"]


def test_apply_drops_existing_string_outside_user_set():
    mod = _reload_with_flag("true")
    qr = _qr(filters={mod.ACL_FILTER_KEY: "team:secret-ops"})
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    # caller cannot widen — "__noresults__" guarantees zero rows
    assert qr.filters[mod.ACL_FILTER_KEY] == ["__noresults__"]


def test_apply_intersects_existing_list_with_user_set():
    mod = _reload_with_flag("true")
    qr = _qr(
        filters={
            mod.ACL_FILTER_KEY: ["team:platform-eng", "team:secret-ops"]
        }
    )
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    assert qr.filters[mod.ACL_FILTER_KEY] == ["team:platform-eng"]


def test_apply_empty_intersection_yields_noresults_sentinel():
    mod = _reload_with_flag("true")
    qr = _qr(filters={mod.ACL_FILTER_KEY: ["team:secret-ops"]})
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    assert qr.filters[mod.ACL_FILTER_KEY] == ["__noresults__"]


def test_apply_unexpected_type_fails_closed():
    mod = _reload_with_flag("true")
    qr = _qr()
    # Bypass pydantic validation — simulate a buggy upstream that
    # somehow planted a non-string/list value into filters.
    object.__setattr__(qr, "filters", {mod.ACL_FILTER_KEY: 42})
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    assert qr.filters[mod.ACL_FILTER_KEY] == ["__noresults__"]


def test_apply_preserves_unrelated_filters():
    mod = _reload_with_flag("true")
    qr = _qr(filters={"datasource_id": "team-eng-kb", "document_type": "doc"})
    mod.apply_doc_acl_filter(qr, _user(groups=["platform-eng"]))
    assert qr.filters["datasource_id"] == "team-eng-kb"
    assert qr.filters["document_type"] == "doc"
    assert mod.ACL_FILTER_KEY in qr.filters
