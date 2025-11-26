"""Model for Searchclustersissuesbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchclustersissuesbody(BaseModel):
  """Searchclustersissuesbody model"""


class SearchclustersissuesbodyResponse(APIResponse):
  """Response model for Searchclustersissuesbody"""

  data: Optional[Searchclustersissuesbody] = None


class SearchclustersissuesbodyListResponse(APIResponse):
  """List response model for Searchclustersissuesbody"""

  data: List[Searchclustersissuesbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
