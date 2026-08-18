from __future__ import annotations

import pytest

from ai_platform_engineering.authz.core.registry import relation_for, select_provider


def test_only_openfga_cel_provider_is_enabled() -> None:
    assert select_provider().name == "openfga-cel"
    with pytest.raises(ValueError, match="disabled"):
        select_provider("cedar")
    with pytest.raises(ValueError, match="disabled"):
        select_provider("opa")


def test_resource_action_mapping_is_server_owned() -> None:
    assert relation_for("tool", "invoke") == "can_call"
    assert relation_for("mcp_server", "invoke") == "can_invoke"
    assert relation_for("agent", "create") == "can_manage"
    assert relation_for("agent", "delete") == "can_delete"
    assert relation_for("organization", "administer") == "can_admin"
    with pytest.raises(ValueError, match="unsupported action"):
        relation_for("tool", "provider_override")
