"""Model for Vectorstoredeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vectorstoredeleterequest(BaseModel):
  """Vectorstoredeleterequest model"""


class VectorstoredeleterequestResponse(APIResponse):
  """Response model for Vectorstoredeleterequest"""

  data: Optional[Vectorstoredeleterequest] = None


class VectorstoredeleterequestListResponse(APIResponse):
  """List response model for Vectorstoredeleterequest"""

  data: List[Vectorstoredeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
