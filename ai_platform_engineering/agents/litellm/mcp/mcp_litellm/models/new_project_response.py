"""Model for Newprojectresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newprojectresponse(BaseModel):
  """Response model for POST /project/new"""


class NewprojectresponseResponse(APIResponse):
  """Response model for Newprojectresponse"""

  data: Optional[Newprojectresponse] = None


class NewprojectresponseListResponse(APIResponse):
  """List response model for Newprojectresponse"""

  data: List[Newprojectresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
