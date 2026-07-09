"""Model for Newmodelgroupresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newmodelgroupresponse(BaseModel):
  """Newmodelgroupresponse model"""


class NewmodelgroupresponseResponse(APIResponse):
  """Response model for Newmodelgroupresponse"""

  data: Optional[Newmodelgroupresponse] = None


class NewmodelgroupresponseListResponse(APIResponse):
  """List response model for Newmodelgroupresponse"""

  data: List[Newmodelgroupresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
