import logging

import pytest

from dynamic_agents.services.mcp_client import sanitize_server_id_for_prefix


def test_valid_id_passes_through():
    assert sanitize_server_id_for_prefix("slack") == "slack"


def test_valid_id_with_hyphen_and_underscore():
    assert sanitize_server_id_for_prefix("my-slack_server") == "my-slack_server"


def test_dollar_prefix_replaced():
    assert sanitize_server_id_for_prefix("$SLACK") == "_SLACK"


def test_dollar_in_middle_replaced():
    assert sanitize_server_id_for_prefix("my$server") == "my_server"


def test_multiple_invalid_chars_all_replaced():
    assert sanitize_server_id_for_prefix("$MY.SERVER@1") == "_MY_SERVER_1"


def test_valid_id_does_not_log_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="dynamic_agents.services.mcp_client"):
        sanitize_server_id_for_prefix("slack")
    assert caplog.records == []


def test_invalid_id_logs_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="dynamic_agents.services.mcp_client"):
        sanitize_server_id_for_prefix("$SLACK")
    assert any("$SLACK" in r.message and "_SLACK" in r.message for r in caplog.records)


@pytest.mark.parametrize("server_id, expected", [
    ("github", "github"),
    ("$SLACK", "_SLACK"),
    ("my.server", "my_server"),
    ("server@host", "server_host"),
    ("123", "123"),
    ("a-b_c", "a-b_c"),
])
def test_parametrized_sanitization(server_id, expected):
    assert sanitize_server_id_for_prefix(server_id) == expected
