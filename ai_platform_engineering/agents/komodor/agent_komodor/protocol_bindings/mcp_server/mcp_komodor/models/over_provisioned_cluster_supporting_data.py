"""Model for Overprovisionedclustersupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Overprovisionedclustersupportingdata(BaseModel):
    """Overprovisionedclustersupportingdata model"""


class OverprovisionedclustersupportingdataResponse(APIResponse):
    """Response model for Overprovisionedclustersupportingdata"""

    data: Optional[Overprovisionedclustersupportingdata] = None


class OverprovisionedclustersupportingdataListResponse(APIResponse):
    """List response model for Overprovisionedclustersupportingdata"""

    data: List[Overprovisionedclustersupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
