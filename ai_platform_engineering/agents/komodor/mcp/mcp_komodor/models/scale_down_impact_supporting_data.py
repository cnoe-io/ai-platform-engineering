"""Model for Scaledownimpactsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scaledownimpactsupportingdata(BaseModel):
    """Scaledownimpactsupportingdata model"""


class ScaledownimpactsupportingdataResponse(APIResponse):
    """Response model for Scaledownimpactsupportingdata"""

    data: Optional[Scaledownimpactsupportingdata] = None


class ScaledownimpactsupportingdataListResponse(APIResponse):
    """List response model for Scaledownimpactsupportingdata"""

    data: List[Scaledownimpactsupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
