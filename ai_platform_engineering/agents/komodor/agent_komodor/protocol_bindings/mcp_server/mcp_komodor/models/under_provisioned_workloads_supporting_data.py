"""Model for Underprovisionedworkloadssupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Underprovisionedworkloadssupportingdata(BaseModel):
    """Underprovisionedworkloadssupportingdata model"""


class UnderprovisionedworkloadssupportingdataResponse(APIResponse):
    """Response model for Underprovisionedworkloadssupportingdata"""

    data: Optional[Underprovisionedworkloadssupportingdata] = None


class UnderprovisionedworkloadssupportingdataListResponse(APIResponse):
    """List response model for Underprovisionedworkloadssupportingdata"""

    data: List[Underprovisionedworkloadssupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
