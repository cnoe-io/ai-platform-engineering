"""Model for Listpluginsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listpluginsresponse(BaseModel):
  """Response from listing plugins."""


class ListpluginsresponseResponse(APIResponse):
  """Response model for Listpluginsresponse"""

  data: Optional[Listpluginsresponse] = None


class ListpluginsresponseListResponse(APIResponse):
  """List response model for Listpluginsresponse"""

  data: List[Listpluginsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
