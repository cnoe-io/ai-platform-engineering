"""Model for Updatecustomactiondto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatecustomactiondto(BaseModel):
    """Updatecustomactiondto model"""


class UpdatecustomactiondtoResponse(APIResponse):
    """Response model for Updatecustomactiondto"""

    data: Optional[Updatecustomactiondto] = None


class UpdatecustomactiondtoListResponse(APIResponse):
    """List response model for Updatecustomactiondto"""

    data: List[Updatecustomactiondto] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
