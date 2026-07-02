"""Model for Blockkeyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blockkeyrequest(BaseModel):
  """Blockkeyrequest model"""


class BlockkeyrequestResponse(APIResponse):
  """Response model for Blockkeyrequest"""

  data: Optional[Blockkeyrequest] = None


class BlockkeyrequestListResponse(APIResponse):
  """List response model for Blockkeyrequest"""

  data: List[Blockkeyrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
