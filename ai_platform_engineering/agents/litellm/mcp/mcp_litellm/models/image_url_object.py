"""Model for Imageurlobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Imageurlobject(BaseModel):
  """Imageurlobject model"""


class ImageurlobjectResponse(APIResponse):
  """Response model for Imageurlobject"""

  data: Optional[Imageurlobject] = None


class ImageurlobjectListResponse(APIResponse):
  """List response model for Imageurlobject"""

  data: List[Imageurlobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
