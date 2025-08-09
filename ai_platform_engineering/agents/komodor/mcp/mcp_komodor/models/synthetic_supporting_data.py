"""Model for Syntheticsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Syntheticsupportingdata(BaseModel):
    """Syntheticsupportingdata model"""


class SyntheticsupportingdataResponse(APIResponse):
    """Response model for Syntheticsupportingdata"""

    data: Optional[Syntheticsupportingdata] = None


class SyntheticsupportingdataListResponse(APIResponse):
    """List response model for Syntheticsupportingdata"""

    data: List[Syntheticsupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
