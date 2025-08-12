"""Model for Containerusagerequestdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Containerusagerequestdata(BaseModel):
    """Containerusagerequestdata model"""


class ContainerusagerequestdataResponse(APIResponse):
    """Response model for Containerusagerequestdata"""

    data: Optional[Containerusagerequestdata] = None


class ContainerusagerequestdataListResponse(APIResponse):
    """List response model for Containerusagerequestdata"""

    data: List[Containerusagerequestdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
