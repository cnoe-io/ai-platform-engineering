"""Model for Accessgroupinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Accessgroupinfo(BaseModel):
  """Accessgroupinfo model"""


class AccessgroupinfoResponse(APIResponse):
  """Response model for Accessgroupinfo"""

  data: Optional[Accessgroupinfo] = None


class AccessgroupinfoListResponse(APIResponse):
  """List response model for Accessgroupinfo"""

  data: List[Accessgroupinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
