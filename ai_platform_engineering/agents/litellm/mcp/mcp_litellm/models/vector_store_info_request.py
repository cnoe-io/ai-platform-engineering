"""Model for Vectorstoreinforequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vectorstoreinforequest(BaseModel):
  """Vectorstoreinforequest model"""


class VectorstoreinforequestResponse(APIResponse):
  """Response model for Vectorstoreinforequest"""

  data: Optional[Vectorstoreinforequest] = None


class VectorstoreinforequestListResponse(APIResponse):
  """List response model for Vectorstoreinforequest"""

  data: List[Vectorstoreinforequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
