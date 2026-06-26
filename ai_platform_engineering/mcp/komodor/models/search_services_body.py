"""Model for Searchservicesbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchservicesbody(BaseModel):
  """Searchservicesbody model"""


class SearchservicesbodyResponse(APIResponse):
  """Response model for Searchservicesbody"""

  data: Optional[Searchservicesbody] = None


class SearchservicesbodyListResponse(APIResponse):
  """List response model for Searchservicesbody"""

  data: List[Searchservicesbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
