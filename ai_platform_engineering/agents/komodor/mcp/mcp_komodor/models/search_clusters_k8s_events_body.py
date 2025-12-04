"""Model for Searchclustersk8seventsbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchclustersk8seventsbody(BaseModel):
  """Searchclustersk8seventsbody model"""


class Searchclustersk8seventsbodyResponse(APIResponse):
  """Response model for Searchclustersk8seventsbody"""

  data: Optional[Searchclustersk8seventsbody] = None


class Searchclustersk8seventsbodyListResponse(APIResponse):
  """List response model for Searchclustersk8seventsbody"""

  data: List[Searchclustersk8seventsbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
