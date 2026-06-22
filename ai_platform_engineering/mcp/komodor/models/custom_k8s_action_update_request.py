"""Model for Customk8sactionupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Customk8sactionupdaterequest(BaseModel):
  """Customk8sactionupdaterequest model"""


class Customk8sactionupdaterequestResponse(APIResponse):
  """Response model for Customk8sactionupdaterequest"""

  data: Optional[Customk8sactionupdaterequest] = None


class Customk8sactionupdaterequestListResponse(APIResponse):
  """List response model for Customk8sactionupdaterequest"""

  data: List[Customk8sactionupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
