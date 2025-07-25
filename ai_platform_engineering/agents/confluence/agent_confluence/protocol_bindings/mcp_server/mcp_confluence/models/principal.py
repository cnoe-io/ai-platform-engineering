
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Principal"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Principal(BaseModel):
    """The principal of the role assignment."""



class PrincipalResponse(APIResponse):
    """Response model for Principal"""
    data: Optional[Principal] = None


class PrincipalListResponse(APIResponse):
    """List response model for Principal"""
    data: List[Principal] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None