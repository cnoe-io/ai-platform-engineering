"""Model for Embeddingrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Embeddingrequest(BaseModel):
  """Embeddingrequest model"""


class EmbeddingrequestResponse(APIResponse):
  """Response model for Embeddingrequest"""

  data: Optional[Embeddingrequest] = None


class EmbeddingrequestListResponse(APIResponse):
  """List response model for Embeddingrequest"""

  data: List[Embeddingrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
