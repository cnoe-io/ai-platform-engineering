"""Model for Scimfeature"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimfeature(BaseModel):
  """Scimfeature model"""


class ScimfeatureResponse(APIResponse):
  """Response model for Scimfeature"""

  data: Optional[Scimfeature] = None


class ScimfeatureListResponse(APIResponse):
  """List response model for Scimfeature"""

  data: List[Scimfeature] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
