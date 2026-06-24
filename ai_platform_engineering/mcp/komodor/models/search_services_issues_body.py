"""Model for Searchservicesissuesbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchservicesissuesbody(BaseModel):
  """Searchservicesissuesbody model"""


class SearchservicesissuesbodyResponse(APIResponse):
  """Response model for Searchservicesissuesbody"""

  data: Optional[Searchservicesissuesbody] = None


class SearchservicesissuesbodyListResponse(APIResponse):
  """List response model for Searchservicesissuesbody"""

  data: List[Searchservicesissuesbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
