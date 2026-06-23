"""Model for Deletemodelgroupresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deletemodelgroupresponse(BaseModel):
  """Deletemodelgroupresponse model"""


class DeletemodelgroupresponseResponse(APIResponse):
  """Response model for Deletemodelgroupresponse"""

  data: Optional[Deletemodelgroupresponse] = None


class DeletemodelgroupresponseListResponse(APIResponse):
  """List response model for Deletemodelgroupresponse"""

  data: List[Deletemodelgroupresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
