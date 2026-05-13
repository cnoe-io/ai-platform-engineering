"""Model for Listguardrailsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listguardrailsresponse(BaseModel):
  """Listguardrailsresponse model"""


class ListguardrailsresponseResponse(APIResponse):
  """Response model for Listguardrailsresponse"""

  data: Optional[Listguardrailsresponse] = None


class ListguardrailsresponseListResponse(APIResponse):
  """List response model for Listguardrailsresponse"""

  data: List[Listguardrailsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
