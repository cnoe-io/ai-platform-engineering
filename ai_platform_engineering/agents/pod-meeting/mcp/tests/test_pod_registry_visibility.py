import pytest
from mcp.shared.exceptions import McpError

from mcp_pod_meeting import mcp_server


def test_requester_email_is_read_from_caipe_header(monkeypatch):
    monkeypatch.setattr(
        mcp_server,
        "get_http_headers",
        lambda include: {"x-caipe-user-email": " Sunny@Example.COM "},
    )

    assert mcp_server._requester_email_from_headers() == "sunny@example.com"


def test_requester_email_is_required(monkeypatch):
    monkeypatch.setattr(mcp_server, "get_http_headers", lambda include: {})

    with pytest.raises(McpError):
        mcp_server._require_requester_email()


def test_pod_visible_to_owner_pgm_roster_and_share_fields():
    assert mcp_server._pod_visible_to_email(
        {"owner_user_id": "sunny@example.com"},
        "sunny@example.com",
    )
    assert mcp_server._pod_visible_to_email(
        {"pgm_email": "Sunny@Example.COM"},
        "sunny@example.com",
    )
    assert mcp_server._pod_visible_to_email(
        {"roster": [{"display_name": "Sunny", "email": "sunny@example.com"}]},
        "sunny@example.com",
    )
    assert mcp_server._pod_visible_to_email(
        {"shared_user_emails": ["sunny@example.com"]},
        "sunny@example.com",
    )


def test_pod_not_visible_without_matching_owner_or_membership():
    pod = {
        "owner_user_id": "someone@example.com",
        "pgm_email": "pgm@example.com",
        "roster": [{"email": "teammate@example.com"}],
    }

    assert not mcp_server._pod_visible_to_email(pod, "sunny@example.com")


def test_pod_owned_by_owner_or_pgm_only():
    pod = {
        "owner_user_id": "owner@example.com",
        "pgm_email": "pgm@example.com",
        "roster": [{"email": "member@example.com"}],
    }

    assert mcp_server._pod_owned_by_email(pod, "owner@example.com")
    assert mcp_server._pod_owned_by_email(pod, "pgm@example.com")
    assert not mcp_server._pod_owned_by_email(pod, "member@example.com")


def test_pod_visibility_filter_scopes_query_to_requester_email():
    query = mcp_server._pod_visibility_filter("sunny@example.com", pod_id="my-pod")

    assert query["$and"][0] == {"_id": "my-pod"}
    visibility = query["$and"][1]
    assert {"owner_user_id": {"$regex": "^sunny@example\\.com$", "$options": "i"}} in visibility["$or"]
    assert {"roster.email": {"$regex": "^sunny@example\\.com$", "$options": "i"}} in visibility["$or"]
