"""Model for Selectorpattern"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Selectorpattern(BaseModel):
    """Selectorpattern model"""


class SelectorpatternResponse(APIResponse):
    """Response model for Selectorpattern"""

    data: Optional[Selectorpattern] = None


class SelectorpatternListResponse(APIResponse):
    """List response model for Selectorpattern"""

    data: List[Selectorpattern] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
