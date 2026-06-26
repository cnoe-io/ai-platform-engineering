"""Model for Emailevent"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Emailevent(BaseModel):
  """Emailevent model"""


class EmaileventResponse(APIResponse):
  """Response model for Emailevent"""

  data: Optional[Emailevent] = None


class EmaileventListResponse(APIResponse):
  """List response model for Emailevent"""

  data: List[Emailevent] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
