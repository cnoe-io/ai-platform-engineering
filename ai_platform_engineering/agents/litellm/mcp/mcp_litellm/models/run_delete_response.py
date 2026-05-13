"""Model for Rundeleteresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rundeleteresponse(BaseModel):
  """Response from deleting a run"""


class RundeleteresponseResponse(APIResponse):
  """Response model for Rundeleteresponse"""

  data: Optional[Rundeleteresponse] = None


class RundeleteresponseListResponse(APIResponse):
  """List response model for Rundeleteresponse"""

  data: List[Rundeleteresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
