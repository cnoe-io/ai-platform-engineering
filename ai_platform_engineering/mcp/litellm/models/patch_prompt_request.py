"""Model for Patchpromptrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Patchpromptrequest(BaseModel):
  """Patchpromptrequest model"""


class PatchpromptrequestResponse(APIResponse):
  """Response model for Patchpromptrequest"""

  data: Optional[Patchpromptrequest] = None


class PatchpromptrequestListResponse(APIResponse):
  """List response model for Patchpromptrequest"""

  data: List[Patchpromptrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
