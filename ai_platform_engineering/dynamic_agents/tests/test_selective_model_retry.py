import pytest

from dynamic_agents.services.middleware import (
    SelectiveModelRetryMiddleware,
    _should_retry_model_call,
    build_middleware,
)


@pytest.mark.parametrize("message", [
    "An error occurred (ValidationException) when calling the ConverseStream operation: "
    "input is too long for requested model",
    "member must satisfy regular expression pattern: [a-zA-Z0-9_-]+",
    "An error occurred (ValidationException): 2 validation errors detected",
])
def test_does_not_retry_permanent_errors(message):
    assert _should_retry_model_call(Exception(message)) is False


@pytest.mark.parametrize("message", [
    "ThrottlingException: Rate exceeded",
    "ServiceUnavailableException: The service is temporarily unavailable",
    "ConnectionError: upstream connect error",
])
def test_retries_transient_errors(message):
    assert _should_retry_model_call(Exception(message)) is True


def test_predicate_is_case_insensitive():
    exc = Exception("VALIDATIONEXCEPTION: Input Is Too Long For Requested Model")
    assert _should_retry_model_call(exc) is False


def test_build_middleware_uses_selective_retry_by_default():
    stack = build_middleware(None, agent_name="test", model_id="test")
    retry = next(m for m in stack if isinstance(m, SelectiveModelRetryMiddleware))
    assert retry is not None
    assert retry.max_retries == 5


def test_selective_retry_fast_fails_on_validation_exception():
    middleware = SelectiveModelRetryMiddleware(max_retries=3, backoff_factor=0.0, on_failure="raise")
    permanent_exc = Exception("ValidationException: member must satisfy regular expression pattern")
    assert middleware.retry_on(permanent_exc) is False


def test_selective_retry_allows_transient_retry():
    middleware = SelectiveModelRetryMiddleware(max_retries=3, backoff_factor=0.0, on_failure="raise")
    transient_exc = Exception("ThrottlingException: Rate exceeded")
    assert middleware.retry_on(transient_exc) is True
