"""Model for K8seventpropswrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class K8seventpropswrapper(BaseModel):
    """K8seventpropswrapper model"""


class K8seventpropswrapperResponse(APIResponse):
    """Response model for K8seventpropswrapper"""

    data: Optional[K8seventpropswrapper] = None


class K8seventpropswrapperListResponse(APIResponse):
    """List response model for K8seventpropswrapper"""

    data: List[K8seventpropswrapper] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
