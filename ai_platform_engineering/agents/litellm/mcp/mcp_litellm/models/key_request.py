"""Model for Keyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Keyrequest(BaseModel):
  """Keyrequest model"""


class KeyrequestResponse(APIResponse):
  """Response model for Keyrequest"""

  data: Optional[Keyrequest] = None


class KeyrequestListResponse(APIResponse):
  """List response model for Keyrequest"""

  data: List[Keyrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
