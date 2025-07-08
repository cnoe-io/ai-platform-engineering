"""Model for Containerrestartssupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Containerrestartssupportingdata(BaseModel):
    """Containerrestartssupportingdata model"""


class ContainerrestartssupportingdataResponse(APIResponse):
    """Response model for Containerrestartssupportingdata"""

    data: Optional[Containerrestartssupportingdata] = None


class ContainerrestartssupportingdataListResponse(APIResponse):
    """List response model for Containerrestartssupportingdata"""

    data: List[Containerrestartssupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
