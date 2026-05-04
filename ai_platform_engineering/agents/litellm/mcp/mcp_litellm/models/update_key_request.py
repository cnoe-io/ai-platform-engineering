"""Model for Updatekeyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatekeyrequest(BaseModel):
  """Updatekeyrequest model"""


class UpdatekeyrequestResponse(APIResponse):
  """Response model for Updatekeyrequest"""

  data: Optional[Updatekeyrequest] = None


class UpdatekeyrequestListResponse(APIResponse):
  """List response model for Updatekeyrequest"""

  data: List[Updatekeyrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
