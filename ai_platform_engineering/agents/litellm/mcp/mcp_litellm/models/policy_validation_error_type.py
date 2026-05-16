"""Model for Policyvalidationerrortype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyvalidationerrortype(BaseModel):
  """Types of validation errors that can occur."""


class PolicyvalidationerrortypeResponse(APIResponse):
  """Response model for Policyvalidationerrortype"""

  data: Optional[Policyvalidationerrortype] = None


class PolicyvalidationerrortypeListResponse(APIResponse):
  """List response model for Policyvalidationerrortype"""

  data: List[Policyvalidationerrortype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
