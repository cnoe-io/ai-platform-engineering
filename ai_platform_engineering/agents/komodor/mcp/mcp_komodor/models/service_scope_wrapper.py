"""Model for Servicescopewrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Servicescopewrapper(BaseModel):
    """Servicescopewrapper model"""


class ServicescopewrapperResponse(APIResponse):
    """Response model for Servicescopewrapper"""

    data: Optional[Servicescopewrapper] = None


class ServicescopewrapperListResponse(APIResponse):
    """List response model for Servicescopewrapper"""

    data: List[Servicescopewrapper] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
