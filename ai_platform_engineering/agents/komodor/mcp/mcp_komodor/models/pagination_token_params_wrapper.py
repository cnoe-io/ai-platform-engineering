"""Model for Paginationtokenparamswrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Paginationtokenparamswrapper(BaseModel):
    """Paginationtokenparamswrapper model"""


class PaginationtokenparamswrapperResponse(APIResponse):
    """Response model for Paginationtokenparamswrapper"""

    data: Optional[Paginationtokenparamswrapper] = None


class PaginationtokenparamswrapperListResponse(APIResponse):
    """List response model for Paginationtokenparamswrapper"""

    data: List[Paginationtokenparamswrapper] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
