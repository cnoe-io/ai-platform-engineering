"""Reviewed policy template registry; raw executable source is never accepted."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from pydantic import Field, field_validator

from ai_platform_engineering.authz.core.contract import StrictModel


class StringArgumentInV1(StrictModel):
    version: str = Field(default="1", pattern=r"^1$")
    template: str = Field(default="string_argument_in_v1", pattern=r"^string_argument_in_v1$")
    field: str = Field(min_length=2, max_length=256, pattern=r"^/.*$")
    values: tuple[str, ...] = Field(min_length=1, max_length=50)

    @field_validator("values")
    @classmethod
    def validate_values(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if any(len(value) > 256 for value in values):
            raise ValueError("policy values must not exceed 256 characters")
        if len(set(values)) != len(values):
            raise ValueError("policy values must be unique")
        return tuple(sorted(values))

    def canonical_document(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "template": self.template,
            "values": list(self.values),
            "version": self.version,
        }

    def sha256(self) -> str:
        encoded = json.dumps(
            self.canonical_document(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
        return f"sha256:{hashlib.sha256(encoded).hexdigest()}"

    def tuple_context(self, *, schema_hash: str) -> dict[str, Any]:
        return {
            "field": self.field,
            "allowed_values": list(self.values),
            "expected_schema_hash": schema_hash,
        }


@dataclass(frozen=True)
class TemplateDescriptor:
    id: str
    version: str
    field_types: tuple[str, ...]
    max_values: int


TEMPLATES = {
    "string_argument_in_v1": TemplateDescriptor(
        id="string_argument_in_v1",
        version="1",
        field_types=("string",),
        max_values=50,
    )
}


def parse_template(value: dict[str, Any]) -> StringArgumentInV1:
    template = value.get("template")
    if template != "string_argument_in_v1":
        raise ValueError("unknown or disabled policy template")
    return StringArgumentInV1.model_validate(value)
