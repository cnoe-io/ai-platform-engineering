# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Model for Category"""

from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo

class Category(BaseModel):
    """Category model"""

    id: Optional[int] = None
    name: Optional[str] = None

class CategoryResponse(APIResponse):
    """Response model for Category"""
    data: Optional[Category] = None

class CategoryListResponse(APIResponse):
    """List response model for Category"""
    data: List[Category] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
