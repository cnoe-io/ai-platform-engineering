from __future__ import annotations

import pytest
from pydantic import ValidationError

from ai_platform_engineering.authz.policy.templates import StringArgumentInV1, parse_template


def test_template_is_canonical_and_code_like_literal_is_data() -> None:
    expression = StringArgumentInV1(
        field="/project_key",
        values=("resource.delete()", "PRIMARY"),
    )
    assert expression.values == ("PRIMARY", "resource.delete()")
    assert expression.sha256().startswith("sha256:")
    assert expression.tuple_context(schema_hash="sha256:" + "a" * 64)["allowed_values"] == [
        "PRIMARY",
        "resource.delete()",
    ]


def test_unknown_raw_policy_language_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown"):
        parse_template({"template": "cel", "source": "true"})


def test_template_bounds_are_enforced() -> None:
    with pytest.raises(ValidationError):
        StringArgumentInV1(field="/project_key", values=tuple(str(i) for i in range(51)))
