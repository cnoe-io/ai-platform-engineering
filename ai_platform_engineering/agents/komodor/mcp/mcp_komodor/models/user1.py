"""Model for User1"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class User1(BaseModel):
  """User1 model"""


class User1Response(APIResponse):
  """Response model for User1"""

  data: Optional[User1] = None


class User1ListResponse(APIResponse):
  """List response model for User1"""

  data: List[User1] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
