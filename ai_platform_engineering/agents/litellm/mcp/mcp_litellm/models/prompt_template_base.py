"""Model for Prompttemplatebase"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Prompttemplatebase(BaseModel):
  """Prompttemplatebase model"""


class PrompttemplatebaseResponse(APIResponse):
  """Response model for Prompttemplatebase"""

  data: Optional[Prompttemplatebase] = None


class PrompttemplatebaseListResponse(APIResponse):
  """List response model for Prompttemplatebase"""

  data: List[Prompttemplatebase] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
