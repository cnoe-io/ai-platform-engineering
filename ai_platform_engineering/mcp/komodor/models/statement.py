"""Model for Statement"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Statement(BaseModel):
  """Statement model"""


class StatementResponse(APIResponse):
  """Response model for Statement"""

  data: Optional[Statement] = None


class StatementListResponse(APIResponse):
  """List response model for Statement"""

  data: List[Statement] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
