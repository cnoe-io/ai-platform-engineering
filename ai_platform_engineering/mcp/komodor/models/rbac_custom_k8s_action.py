"""Model for Rbaccustomk8saction"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rbaccustomk8saction(BaseModel):
  """Rbaccustomk8saction model"""


class Rbaccustomk8sactionResponse(APIResponse):
  """Response model for Rbaccustomk8saction"""

  data: Optional[Rbaccustomk8saction] = None


class Rbaccustomk8sactionListResponse(APIResponse):
  """List response model for Rbaccustomk8saction"""

  data: List[Rbaccustomk8saction] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
