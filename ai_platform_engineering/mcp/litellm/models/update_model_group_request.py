"""Model for Updatemodelgrouprequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatemodelgrouprequest(BaseModel):
  """Updatemodelgrouprequest model"""


class UpdatemodelgrouprequestResponse(APIResponse):
  """Response model for Updatemodelgrouprequest"""

  data: Optional[Updatemodelgrouprequest] = None


class UpdatemodelgrouprequestListResponse(APIResponse):
  """List response model for Updatemodelgrouprequest"""

  data: List[Updatemodelgrouprequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
