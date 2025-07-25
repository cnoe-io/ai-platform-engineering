
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Model for Classificationlevelstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Classificationlevelstatus(BaseModel):
    """Classificationlevelstatus model"""



class ClassificationlevelstatusResponse(APIResponse):
    """Response model for Classificationlevelstatus"""
    data: Optional[Classificationlevelstatus] = None


class ClassificationlevelstatusListResponse(APIResponse):
    """List response model for Classificationlevelstatus"""
    data: List[Classificationlevelstatus] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None