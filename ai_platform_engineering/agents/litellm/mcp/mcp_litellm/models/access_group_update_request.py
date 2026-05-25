"""Model for Accessgroupupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Accessgroupupdaterequest(BaseModel):
  """Accessgroupupdaterequest model"""


class AccessgroupupdaterequestResponse(APIResponse):
  """Response model for Accessgroupupdaterequest"""

  data: Optional[Accessgroupupdaterequest] = None


class AccessgroupupdaterequestListResponse(APIResponse):
  """List response model for Accessgroupupdaterequest"""

  data: List[Accessgroupupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
