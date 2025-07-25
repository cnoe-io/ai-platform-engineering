
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Blogpostcontentstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blogpostcontentstatus(BaseModel):
    """The status of the content."""



class BlogpostcontentstatusResponse(APIResponse):
    """Response model for Blogpostcontentstatus"""
    data: Optional[Blogpostcontentstatus] = None


class BlogpostcontentstatusListResponse(APIResponse):
    """List response model for Blogpostcontentstatus"""
    data: List[Blogpostcontentstatus] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None