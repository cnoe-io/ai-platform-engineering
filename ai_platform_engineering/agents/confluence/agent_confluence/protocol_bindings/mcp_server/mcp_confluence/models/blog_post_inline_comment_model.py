
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Blogpostinlinecommentmodel"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blogpostinlinecommentmodel(BaseModel):
    """Blogpostinlinecommentmodel model"""



class BlogpostinlinecommentmodelResponse(APIResponse):
    """Response model for Blogpostinlinecommentmodel"""
    data: Optional[Blogpostinlinecommentmodel] = None


class BlogpostinlinecommentmodelListResponse(APIResponse):
    """List response model for Blogpostinlinecommentmodel"""
    data: List[Blogpostinlinecommentmodel] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None