"""Model for Prompttokensdetails"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Prompttokensdetails(BaseModel):
  """Prompttokensdetails model"""


class PrompttokensdetailsResponse(APIResponse):
  """Response model for Prompttokensdetails"""

  data: Optional[Prompttokensdetails] = None


class PrompttokensdetailsListResponse(APIResponse):
  """List response model for Prompttokensdetails"""

  data: List[Prompttokensdetails] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
