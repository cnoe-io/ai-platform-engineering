"""Model for Tagnewrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tagnewrequest(BaseModel):
  """Tagnewrequest model"""


class TagnewrequestResponse(APIResponse):
  """Response model for Tagnewrequest"""

  data: Optional[Tagnewrequest] = None


class TagnewrequestListResponse(APIResponse):
  """List response model for Tagnewrequest"""

  data: List[Tagnewrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
