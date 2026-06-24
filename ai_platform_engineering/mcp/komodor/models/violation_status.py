"""Model for Violationstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Violationstatus(BaseModel):
  """Violationstatus model"""


class ViolationstatusResponse(APIResponse):
  """Response model for Violationstatus"""

  data: Optional[Violationstatus] = None


class ViolationstatusListResponse(APIResponse):
  """List response model for Violationstatus"""

  data: List[Violationstatus] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
