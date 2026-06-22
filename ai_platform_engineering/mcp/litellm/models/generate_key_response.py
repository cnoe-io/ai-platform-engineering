"""Model for Generatekeyresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Generatekeyresponse(BaseModel):
  """Generatekeyresponse model"""


class GeneratekeyresponseResponse(APIResponse):
  """Response model for Generatekeyresponse"""

  data: Optional[Generatekeyresponse] = None


class GeneratekeyresponseListResponse(APIResponse):
  """List response model for Generatekeyresponse"""

  data: List[Generatekeyresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
