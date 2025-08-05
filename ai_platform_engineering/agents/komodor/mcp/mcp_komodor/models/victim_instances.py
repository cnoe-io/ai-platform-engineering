"""Model for Victiminstances"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Victiminstances(BaseModel):
    """Victiminstances model"""


class VictiminstancesResponse(APIResponse):
    """Response model for Victiminstances"""

    data: Optional[Victiminstances] = None


class VictiminstancesListResponse(APIResponse):
    """List response model for Victiminstances"""

    data: List[Victiminstances] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
