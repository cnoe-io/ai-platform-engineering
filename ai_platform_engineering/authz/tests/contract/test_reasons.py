from ai_platform_engineering.authz.core.reasons import ReasonCode, is_retriable


def test_reason_values_are_stable_and_failures_are_classified() -> None:
    assert ReasonCode.ALLOW_RELATIONSHIP.value == "ALLOW_RELATIONSHIP"
    assert ReasonCode.DENY_NO_RELATIONSHIP.value == "DENY_NO_RELATIONSHIP"
    assert is_retriable(ReasonCode.DENY_PROVIDER_TIMEOUT) is True
    assert is_retriable(ReasonCode.DENY_PROVIDER_UNAVAILABLE) is True
    assert is_retriable(ReasonCode.DENY_NO_RELATIONSHIP) is False
    assert is_retriable("UNKNOWN_REASON") is False
