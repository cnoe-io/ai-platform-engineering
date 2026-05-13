"""Model for Regeneratekeyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Regeneratekeyrequest(BaseModel):
  """Regeneratekeyrequest model"""


class RegeneratekeyrequestResponse(APIResponse):
  """Response model for Regeneratekeyrequest"""

  data: Optional[Regeneratekeyrequest] = None


class RegeneratekeyrequestListResponse(APIResponse):
  """List response model for Regeneratekeyrequest"""

  data: List[Regeneratekeyrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
