"""Model for Nodeterminationimpactsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Nodeterminationimpactsupportingdata(BaseModel):
    """Nodeterminationimpactsupportingdata model"""


class NodeterminationimpactsupportingdataResponse(APIResponse):
    """Response model for Nodeterminationimpactsupportingdata"""

    data: Optional[Nodeterminationimpactsupportingdata] = None


class NodeterminationimpactsupportingdataListResponse(APIResponse):
    """List response model for Nodeterminationimpactsupportingdata"""

    data: List[Nodeterminationimpactsupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
