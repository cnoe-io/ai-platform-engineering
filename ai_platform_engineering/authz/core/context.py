"""Trusted context construction and bounded MCP argument projection."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ai_platform_engineering.authz.core.contract import DecisionContext


class ContextError(ValueError):
    """Context cannot be safely normalized."""


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ContextError("request contains a duplicate JSON key")
        value[key] = item
    return value


def parse_bounded_json(raw: bytes, *, max_bytes: int) -> dict[str, Any]:
    if len(raw) > max_bytes:
        raise ContextError("request body exceeds context limit")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except UnicodeDecodeError as exc:
        raise ContextError("request body must be UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise ContextError("request body must be valid JSON") from exc
    if not isinstance(value, dict):
        raise ContextError("request body must be an object")
    return value


def _pointer_escape(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


@dataclass(frozen=True)
class ProjectedArguments:
    strings: dict[str, str]
    integers: dict[str, int]
    booleans: dict[str, bool]

    def openfga_context(self, schema_hash: str) -> dict[str, object]:
        return {
            "schema_hash": schema_hash,
            "string_arguments": self.strings,
            "integer_arguments": self.integers,
            "boolean_arguments": self.booleans,
        }


def project_arguments(
    arguments: dict[str, Any],
    *,
    max_depth: int = 8,
    max_fields: int = 64,
    max_bytes: int = 16384,
) -> ProjectedArguments:
    strings: dict[str, str] = {}
    integers: dict[str, int] = {}
    booleans: dict[str, bool] = {}
    field_count = 0

    def visit(value: Any, pointer: str, depth: int) -> None:
        nonlocal field_count
        if depth > max_depth:
            raise ContextError("arguments exceed maximum depth")
        if isinstance(value, dict):
            for key in sorted(value):
                if not isinstance(key, str):
                    raise ContextError("argument keys must be strings")
                visit(value[key], f"{pointer}/{_pointer_escape(key)}", depth + 1)
            return
        if isinstance(value, list) or value is None or isinstance(value, float):
            return
        field_count += 1
        if field_count > max_fields:
            raise ContextError("arguments exceed maximum field count")
        if isinstance(value, bool):
            booleans[pointer] = value
        elif isinstance(value, int):
            integers[pointer] = value
        elif isinstance(value, str):
            strings[pointer] = value

    visit(arguments, "", 0)
    projected = ProjectedArguments(strings, integers, booleans)
    size = len(json.dumps(projected.__dict__, sort_keys=True, separators=(",", ":")).encode())
    if size > max_bytes:
        raise ContextError("projected arguments exceed maximum context size")
    return projected


def provider_context(context: DecisionContext) -> dict[str, object] | None:
    arguments = context.request.arguments
    schema_hash = context.resource.schema_hash
    if arguments is None or schema_hash is None:
        return None
    projected = project_arguments(arguments)
    return projected.openfga_context(schema_hash)


def narrow_advisory_context(value: dict[str, Any]) -> dict[str, bool | int | str]:
    narrowed: dict[str, bool | int | str] = {}
    for key, item in value.items():
        if key.startswith("trusted_") or key in {"provider", "mode", "cohort", "server_time"}:
            continue
        if isinstance(item, (bool, int, str)) and len(str(item)) <= 256:
            narrowed[key] = item
    return narrowed
