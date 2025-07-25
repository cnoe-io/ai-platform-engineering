
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Label"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Label(BaseModel):
    """Label model"""



class LabelResponse(APIResponse):
    """Response model for Label"""
    data: Optional[Label] = None


class LabelListResponse(APIResponse):
    """List response model for Label"""
    data: List[Label] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None