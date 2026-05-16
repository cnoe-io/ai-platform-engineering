"""Model for Teammemberupdateresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammemberupdateresponse(BaseModel):
  """Teammemberupdateresponse model"""


class TeammemberupdateresponseResponse(APIResponse):
  """Response model for Teammemberupdateresponse"""

  data: Optional[Teammemberupdateresponse] = None


class TeammemberupdateresponseListResponse(APIResponse):
  """List response model for Teammemberupdateresponse"""

  data: List[Teammemberupdateresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
