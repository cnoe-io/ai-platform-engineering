"""Model for Patchguardrailrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Patchguardrailrequest(BaseModel):
  """Patchguardrailrequest model"""


class PatchguardrailrequestResponse(APIResponse):
  """Response model for Patchguardrailrequest"""

  data: Optional[Patchguardrailrequest] = None


class PatchguardrailrequestListResponse(APIResponse):
  """List response model for Patchguardrailrequest"""

  data: List[Patchguardrailrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
