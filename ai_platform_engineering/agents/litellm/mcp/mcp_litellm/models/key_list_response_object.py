"""Model for Keylistresponseobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Keylistresponseobject(BaseModel):
  """Keylistresponseobject model"""


class KeylistresponseobjectResponse(APIResponse):
  """Response model for Keylistresponseobject"""

  data: Optional[Keylistresponseobject] = None


class KeylistresponseobjectListResponse(APIResponse):
  """List response model for Keylistresponseobject"""

  data: List[Keylistresponseobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
