"""Model for Suggesttemplatesrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Suggesttemplatesrequest(BaseModel):
  """Suggesttemplatesrequest model"""


class SuggesttemplatesrequestResponse(APIResponse):
  """Response model for Suggesttemplatesrequest"""

  data: Optional[Suggesttemplatesrequest] = None


class SuggesttemplatesrequestListResponse(APIResponse):
  """List response model for Suggesttemplatesrequest"""

  data: List[Suggesttemplatesrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
