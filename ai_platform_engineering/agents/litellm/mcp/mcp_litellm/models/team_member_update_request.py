"""Model for Teammemberupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammemberupdaterequest(BaseModel):
  """Teammemberupdaterequest model"""


class TeammemberupdaterequestResponse(APIResponse):
  """Response model for Teammemberupdaterequest"""

  data: Optional[Teammemberupdaterequest] = None


class TeammemberupdaterequestListResponse(APIResponse):
  """List response model for Teammemberupdaterequest"""

  data: List[Teammemberupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
