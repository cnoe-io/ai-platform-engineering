"""Model for Apikeyvalidationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Apikeyvalidationresponse(BaseModel):
  """Apikeyvalidationresponse model"""


class ApikeyvalidationresponseResponse(APIResponse):
  """Response model for Apikeyvalidationresponse"""

  data: Optional[Apikeyvalidationresponse] = None


class ApikeyvalidationresponseListResponse(APIResponse):
  """List response model for Apikeyvalidationresponse"""

  data: List[Apikeyvalidationresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
