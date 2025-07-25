# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Nullableentity"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Nullableentity(BaseModel):
    """The parts of the format that's common to all versions/kinds of entity."""


class NullableentityResponse(APIResponse):
    """Response model for Nullableentity"""

    data: Optional[Nullableentity] = None


class NullableentityListResponse(APIResponse):
    """List response model for Nullableentity"""

    data: List[Nullableentity] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
