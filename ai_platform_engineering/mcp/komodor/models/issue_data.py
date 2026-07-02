"""Model for Issuedata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Issuedata(BaseModel):
  """Issuedata model"""


class IssuedataResponse(APIResponse):
  """Response model for Issuedata"""

  data: Optional[Issuedata] = None


class IssuedataListResponse(APIResponse):
  """List response model for Issuedata"""

  data: List[Issuedata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
