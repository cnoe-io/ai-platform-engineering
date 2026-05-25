"""Model for Scimlistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimlistresponse(BaseModel):
  """Scimlistresponse model"""


class ScimlistresponseResponse(APIResponse):
  """Response model for Scimlistresponse"""

  data: Optional[Scimlistresponse] = None


class ScimlistresponseListResponse(APIResponse):
  """List response model for Scimlistresponse"""

  data: List[Scimlistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
