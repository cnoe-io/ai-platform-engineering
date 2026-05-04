"""Model for Rejectmcpserverrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rejectmcpserverrequest(BaseModel):
  """Rejectmcpserverrequest model"""


class RejectmcpserverrequestResponse(APIResponse):
  """Response model for Rejectmcpserverrequest"""

  data: Optional[Rejectmcpserverrequest] = None


class RejectmcpserverrequestListResponse(APIResponse):
  """List response model for Rejectmcpserverrequest"""

  data: List[Rejectmcpserverrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
