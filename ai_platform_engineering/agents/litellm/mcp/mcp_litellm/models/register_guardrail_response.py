"""Model for Registerguardrailresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Registerguardrailresponse(BaseModel):
  """Registerguardrailresponse model"""


class RegisterguardrailresponseResponse(APIResponse):
  """Response model for Registerguardrailresponse"""

  data: Optional[Registerguardrailresponse] = None


class RegisterguardrailresponseListResponse(APIResponse):
  """List response model for Registerguardrailresponse"""

  data: List[Registerguardrailresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
