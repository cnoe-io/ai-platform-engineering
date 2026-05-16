"""Model for Successfulkeyupdate"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Successfulkeyupdate(BaseModel):
  """Successfully updated key with its updated information"""


class SuccessfulkeyupdateResponse(APIResponse):
  """Response model for Successfulkeyupdate"""

  data: Optional[Successfulkeyupdate] = None


class SuccessfulkeyupdateListResponse(APIResponse):
  """List response model for Successfulkeyupdate"""

  data: List[Successfulkeyupdate] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
