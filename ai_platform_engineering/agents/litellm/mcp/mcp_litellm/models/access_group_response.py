"""Model for Accessgroupresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Accessgroupresponse(BaseModel):
  """Accessgroupresponse model"""


class AccessgroupresponseResponse(APIResponse):
  """Response model for Accessgroupresponse"""

  data: Optional[Accessgroupresponse] = None


class AccessgroupresponseListResponse(APIResponse):
  """List response model for Accessgroupresponse"""

  data: List[Accessgroupresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
