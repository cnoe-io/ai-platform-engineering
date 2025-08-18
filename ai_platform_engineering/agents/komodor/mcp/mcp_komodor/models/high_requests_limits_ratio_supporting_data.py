"""Model for Highrequestslimitsratiosupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Highrequestslimitsratiosupportingdata(BaseModel):
    """Highrequestslimitsratiosupportingdata model"""


class HighrequestslimitsratiosupportingdataResponse(APIResponse):
    """Response model for Highrequestslimitsratiosupportingdata"""

    data: Optional[Highrequestslimitsratiosupportingdata] = None


class HighrequestslimitsratiosupportingdataListResponse(APIResponse):
    """List response model for Highrequestslimitsratiosupportingdata"""

    data: List[Highrequestslimitsratiosupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
