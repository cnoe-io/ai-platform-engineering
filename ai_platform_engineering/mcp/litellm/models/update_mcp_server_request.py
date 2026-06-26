"""Model for Updatemcpserverrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatemcpserverrequest(BaseModel):
  """Updatemcpserverrequest model"""


class UpdatemcpserverrequestResponse(APIResponse):
  """Response model for Updatemcpserverrequest"""

  data: Optional[Updatemcpserverrequest] = None


class UpdatemcpserverrequestListResponse(APIResponse):
  """List response model for Updatemcpserverrequest"""

  data: List[Updatemcpserverrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
