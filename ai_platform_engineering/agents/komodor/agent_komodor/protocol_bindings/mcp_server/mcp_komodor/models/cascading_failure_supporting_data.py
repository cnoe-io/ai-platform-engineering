"""Model for Cascadingfailuresupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cascadingfailuresupportingdata(BaseModel):
    """Cascadingfailuresupportingdata model"""


class CascadingfailuresupportingdataResponse(APIResponse):
    """Response model for Cascadingfailuresupportingdata"""

    data: Optional[Cascadingfailuresupportingdata] = None


class CascadingfailuresupportingdataListResponse(APIResponse):
    """List response model for Cascadingfailuresupportingdata"""

    data: List[Cascadingfailuresupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
