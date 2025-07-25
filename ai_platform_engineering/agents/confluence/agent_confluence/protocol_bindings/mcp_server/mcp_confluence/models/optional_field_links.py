
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Optionalfieldlinks"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Optionalfieldlinks(BaseModel):
    """Optionalfieldlinks model"""



class OptionalfieldlinksResponse(APIResponse):
    """Response model for Optionalfieldlinks"""
    data: Optional[Optionalfieldlinks] = None


class OptionalfieldlinksListResponse(APIResponse):
    """List response model for Optionalfieldlinks"""
    data: List[Optionalfieldlinks] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None