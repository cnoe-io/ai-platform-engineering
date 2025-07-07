"""Model for Error"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Error(BaseModel):
    """Error model"""


class ErrorResponse(APIResponse):
    """Response model for Error"""

    data: Optional[Error] = None


class ErrorListResponse(APIResponse):
    """List response model for Error"""

    data: List[Error] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
