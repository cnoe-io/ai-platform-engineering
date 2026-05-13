"""Model for Makeagentspublicrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Makeagentspublicrequest(BaseModel):
  """Makeagentspublicrequest model"""


class MakeagentspublicrequestResponse(APIResponse):
  """Response model for Makeagentspublicrequest"""

  data: Optional[Makeagentspublicrequest] = None


class MakeagentspublicrequestListResponse(APIResponse):
  """List response model for Makeagentspublicrequest"""

  data: List[Makeagentspublicrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
