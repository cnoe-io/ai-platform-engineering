"""Model for Action"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Action(BaseModel):
    """Action model"""


class ActionResponse(APIResponse):
    """Response model for Action"""

    data: Optional[Action] = None


class ActionListResponse(APIResponse):
    """List response model for Action"""

    data: List[Action] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
