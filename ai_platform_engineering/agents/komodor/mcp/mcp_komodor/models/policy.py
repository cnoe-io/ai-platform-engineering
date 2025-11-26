"""Model for Policy"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policy(BaseModel):
  """Policy model"""


class PolicyResponse(APIResponse):
  """Response model for Policy"""

  data: Optional[Policy] = None


class PolicyListResponse(APIResponse):
  """List response model for Policy"""

  data: List[Policy] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
