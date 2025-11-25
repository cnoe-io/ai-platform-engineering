"""Model for Violationstatusrequestparam"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Violationstatusrequestparam(BaseModel):
  """Violationstatusrequestparam model"""


class ViolationstatusrequestparamResponse(APIResponse):
  """Response model for Violationstatusrequestparam"""

  data: Optional[Violationstatusrequestparam] = None


class ViolationstatusrequestparamListResponse(APIResponse):
  """List response model for Violationstatusrequestparam"""

  data: List[Violationstatusrequestparam] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
