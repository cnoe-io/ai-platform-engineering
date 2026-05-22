"""Model for Patchagentrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Patchagentrequest(BaseModel):
  """Patchagentrequest model"""


class PatchagentrequestResponse(APIResponse):
  """Response model for Patchagentrequest"""

  data: Optional[Patchagentrequest] = None


class PatchagentrequestListResponse(APIResponse):
  """List response model for Patchagentrequest"""

  data: List[Patchagentrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
