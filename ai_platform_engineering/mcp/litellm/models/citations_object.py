"""Model for Citationsobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Citationsobject(BaseModel):
  """Citationsobject model"""


class CitationsobjectResponse(APIResponse):
  """Response model for Citationsobject"""

  data: Optional[Citationsobject] = None


class CitationsobjectListResponse(APIResponse):
  """List response model for Citationsobject"""

  data: List[Citationsobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
