# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ai_platform_engineering.utils.cel_evaluator."""

from __future__ import annotations

from ai_platform_engineering.utils.cel_evaluator import _normalize_for_json, evaluate


def test_evaluate_empty_or_whitespace_is_allow():
    assert evaluate("", {"action": "x"}) is True
    assert evaluate("   ", {"action": "x"}) is True


def test_evaluate_simple_bool():
    ctx = {"user": {"email": "a@b.com"}, "action": "view"}
    assert evaluate("true", ctx) is True
    assert evaluate("false", ctx) is False


def test_evaluate_user_field():
    ctx = {"user": {"roles": ["admin"]}, "action": "invoke"}
    assert evaluate("'admin' in user.roles", ctx) is True
    assert evaluate("'guest' in user.roles", ctx) is False


def test_evaluate_invalid_expression_fails_closed():
    assert evaluate("+++", {"a": 1}) is False


def test_normalize_for_json_nested():
    class NS:
        def __str__(self):
            return "x"

    out = _normalize_for_json({"a": 1, "b": {"c": NS()}, "d": [1, NS()]})
    assert out["a"] == 1
    assert out["b"]["c"] == "x"
    assert out["d"] == [1, "x"]
