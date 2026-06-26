"""Model for LitellmProjecttable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmProjecttable(BaseModel):
  """Database model representation for project"""


class LitellmProjecttableResponse(APIResponse):
  """Response model for LitellmProjecttable"""

  data: Optional[LitellmProjecttable] = None


class LitellmProjecttableListResponse(APIResponse):
  """List response model for LitellmProjecttable"""

  data: List[LitellmProjecttable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
