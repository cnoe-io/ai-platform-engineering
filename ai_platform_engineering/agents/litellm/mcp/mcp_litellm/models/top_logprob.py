"""Model for Toplogprob"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toplogprob(BaseModel):
  """Toplogprob model"""


class ToplogprobResponse(APIResponse):
  """Response model for Toplogprob"""

  data: Optional[Toplogprob] = None


class ToplogprobListResponse(APIResponse):
  """List response model for Toplogprob"""

  data: List[Toplogprob] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
