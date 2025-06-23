# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Model for Pet"""

from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo

class Pet(BaseModel):
    """Pet model"""

    id: Optional[int] = None
    name: str
    category: Optional[str] = None
    photoUrls: List[str]
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    """pet status in the store"""

class PetResponse(APIResponse):
    """Response model for Pet"""
    data: Optional[Pet] = None

class PetListResponse(APIResponse):
    """List response model for Pet"""
    data: List[Pet] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
