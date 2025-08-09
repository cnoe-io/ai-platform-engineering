"""Model for Errorwrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Errorwrapper(BaseModel):
    """Errorwrapper model"""


class ErrorwrapperResponse(APIResponse):
    """Response model for Errorwrapper"""

    data: Optional[Errorwrapper] = None


class ErrorwrapperListResponse(APIResponse):
    """List response model for Errorwrapper"""

    data: List[Errorwrapper] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
