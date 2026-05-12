"""Model for Vantageexportrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantageexportrequest(BaseModel):
  """Request model for Vantage export operations (actual export, no default limit)"""


class VantageexportrequestResponse(APIResponse):
  """Response model for Vantageexportrequest"""

  data: Optional[Vantageexportrequest] = None


class VantageexportrequestListResponse(APIResponse):
  """List response model for Vantageexportrequest"""

  data: List[Vantageexportrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
