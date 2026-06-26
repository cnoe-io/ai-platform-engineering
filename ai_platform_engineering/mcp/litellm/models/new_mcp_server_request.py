"""Model for Newmcpserverrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newmcpserverrequest(BaseModel):
  """Newmcpserverrequest model"""


class NewmcpserverrequestResponse(APIResponse):
  """Response model for Newmcpserverrequest"""

  data: Optional[Newmcpserverrequest] = None


class NewmcpserverrequestListResponse(APIResponse):
  """List response model for Newmcpserverrequest"""

  data: List[Newmcpserverrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
