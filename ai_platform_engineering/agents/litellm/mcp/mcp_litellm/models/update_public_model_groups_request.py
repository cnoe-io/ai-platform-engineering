"""Model for Updatepublicmodelgroupsrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatepublicmodelgroupsrequest(BaseModel):
  """Request model for updating public model groups"""


class UpdatepublicmodelgroupsrequestResponse(APIResponse):
  """Response model for Updatepublicmodelgroupsrequest"""

  data: Optional[Updatepublicmodelgroupsrequest] = None


class UpdatepublicmodelgroupsrequestListResponse(APIResponse):
  """List response model for Updatepublicmodelgroupsrequest"""

  data: List[Updatepublicmodelgroupsrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
