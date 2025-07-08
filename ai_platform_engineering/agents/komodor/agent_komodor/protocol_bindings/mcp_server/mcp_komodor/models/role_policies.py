"""Model for Rolepolicies"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rolepolicies(BaseModel):
    """Rolepolicies model"""


class RolepoliciesResponse(APIResponse):
    """Response model for Rolepolicies"""

    data: Optional[Rolepolicies] = None


class RolepoliciesListResponse(APIResponse):
    """List response model for Rolepolicies"""

    data: List[Rolepolicies] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
