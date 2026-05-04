"""Model for Tagupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tagupdaterequest(BaseModel):
  """Tagupdaterequest model"""


class TagupdaterequestResponse(APIResponse):
  """Response model for Tagupdaterequest"""

  data: Optional[Tagupdaterequest] = None


class TagupdaterequestListResponse(APIResponse):
  """List response model for Tagupdaterequest"""

  data: List[Tagupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
