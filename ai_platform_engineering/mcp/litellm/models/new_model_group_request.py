"""Model for Newmodelgrouprequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newmodelgrouprequest(BaseModel):
  """Newmodelgrouprequest model"""


class NewmodelgrouprequestResponse(APIResponse):
  """Response model for Newmodelgrouprequest"""

  data: Optional[Newmodelgrouprequest] = None


class NewmodelgrouprequestListResponse(APIResponse):
  """List response model for Newmodelgrouprequest"""

  data: List[Newmodelgrouprequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
