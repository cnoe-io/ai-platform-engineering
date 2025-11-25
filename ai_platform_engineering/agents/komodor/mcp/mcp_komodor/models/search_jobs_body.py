"""Model for Searchjobsbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchjobsbody(BaseModel):
  """Searchjobsbody model"""


class SearchjobsbodyResponse(APIResponse):
  """Response model for Searchjobsbody"""

  data: Optional[Searchjobsbody] = None


class SearchjobsbodyListResponse(APIResponse):
  """List response model for Searchjobsbody"""

  data: List[Searchjobsbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
