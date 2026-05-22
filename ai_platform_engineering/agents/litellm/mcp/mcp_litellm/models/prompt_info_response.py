"""Model for Promptinforesponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Promptinforesponse(BaseModel):
  """Promptinforesponse model"""


class PromptinforesponseResponse(APIResponse):
  """Response model for Promptinforesponse"""

  data: Optional[Promptinforesponse] = None


class PromptinforesponseListResponse(APIResponse):
  """List response model for Promptinforesponse"""

  data: List[Promptinforesponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
