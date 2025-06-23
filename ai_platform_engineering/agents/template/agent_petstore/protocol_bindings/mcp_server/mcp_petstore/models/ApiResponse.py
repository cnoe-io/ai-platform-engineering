# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Model for ApiResponse"""

from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo

class Apiresponse(BaseModel):
    """Apiresponse model"""

    code: Optional[int] = None
    type: Optional[str] = None
    message: Optional[str] = None

class ApiresponseResponse(APIResponse):
    """Response model for Apiresponse"""
    data: Optional[Apiresponse] = None

class ApiresponseListResponse(APIResponse):
    """List response model for Apiresponse"""
    data: List[Apiresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
