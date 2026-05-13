"""Model for Piiaction"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Piiaction(BaseModel):
  """Piiaction model"""


class PiiactionResponse(APIResponse):
  """Response model for Piiaction"""

  data: Optional[Piiaction] = None


class PiiactionListResponse(APIResponse):
  """List response model for Piiaction"""

  data: List[Piiaction] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
