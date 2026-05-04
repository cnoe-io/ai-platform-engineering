"""Model for Documentobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Documentobject(BaseModel):
  """Documentobject model"""


class DocumentobjectResponse(APIResponse):
  """Response model for Documentobject"""

  data: Optional[Documentobject] = None


class DocumentobjectListResponse(APIResponse):
  """List response model for Documentobject"""

  data: List[Documentobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
