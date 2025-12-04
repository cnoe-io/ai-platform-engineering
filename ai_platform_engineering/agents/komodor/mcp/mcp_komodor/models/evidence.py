"""Model for Evidence"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Evidence(BaseModel):
  """Evidence model"""


class EvidenceResponse(APIResponse):
  """Response model for Evidence"""

  data: Optional[Evidence] = None


class EvidenceListResponse(APIResponse):
  """List response model for Evidence"""

  data: List[Evidence] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
