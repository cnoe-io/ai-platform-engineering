
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Footercommentmodel"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Footercommentmodel(BaseModel):
    """Footercommentmodel model"""



class FootercommentmodelResponse(APIResponse):
    """Response model for Footercommentmodel"""
    data: Optional[Footercommentmodel] = None


class FootercommentmodelListResponse(APIResponse):
    """List response model for Footercommentmodel"""
    data: List[Footercommentmodel] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None