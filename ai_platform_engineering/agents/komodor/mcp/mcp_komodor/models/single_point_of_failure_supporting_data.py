"""Model for Singlepointoffailuresupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singlepointoffailuresupportingdata(BaseModel):
    """Singlepointoffailuresupportingdata model"""


class SinglepointoffailuresupportingdataResponse(APIResponse):
    """Response model for Singlepointoffailuresupportingdata"""

    data: Optional[Singlepointoffailuresupportingdata] = None


class SinglepointoffailuresupportingdataListResponse(APIResponse):
    """List response model for Singlepointoffailuresupportingdata"""

    data: List[Singlepointoffailuresupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
