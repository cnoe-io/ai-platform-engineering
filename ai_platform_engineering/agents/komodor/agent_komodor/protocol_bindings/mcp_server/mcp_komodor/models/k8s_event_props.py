"""Model for K8seventprops"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class K8seventprops(BaseModel):
    """K8seventprops model"""


class K8seventpropsResponse(APIResponse):
    """Response model for K8seventprops"""

    data: Optional[K8seventprops] = None


class K8seventpropsListResponse(APIResponse):
    """List response model for K8seventprops"""

    data: List[K8seventprops] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
