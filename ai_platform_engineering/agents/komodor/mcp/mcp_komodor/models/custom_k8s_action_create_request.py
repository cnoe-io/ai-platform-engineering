"""Model for Customk8sactioncreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Customk8sactioncreaterequest(BaseModel):
  """Customk8sactioncreaterequest model"""


class Customk8sactioncreaterequestResponse(APIResponse):
  """Response model for Customk8sactioncreaterequest"""

  data: Optional[Customk8sactioncreaterequest] = None


class Customk8sactioncreaterequestListResponse(APIResponse):
  """List response model for Customk8sactioncreaterequest"""

  data: List[Customk8sactioncreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
