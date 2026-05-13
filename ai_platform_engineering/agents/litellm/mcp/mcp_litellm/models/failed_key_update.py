"""Model for Failedkeyupdate"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Failedkeyupdate(BaseModel):
  """Failed key update with reason"""


class FailedkeyupdateResponse(APIResponse):
  """Response model for Failedkeyupdate"""

  data: Optional[Failedkeyupdate] = None


class FailedkeyupdateListResponse(APIResponse):
  """List response model for Failedkeyupdate"""

  data: List[Failedkeyupdate] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
