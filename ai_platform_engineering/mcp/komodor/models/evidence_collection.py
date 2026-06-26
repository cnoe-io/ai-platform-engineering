"""Model for Evidencecollection"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Evidencecollection(BaseModel):
  """Evidencecollection model"""


class EvidencecollectionResponse(APIResponse):
  """Response model for Evidencecollection"""

  data: Optional[Evidencecollection] = None


class EvidencecollectionListResponse(APIResponse):
  """List response model for Evidencecollection"""

  data: List[Evidencecollection] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
