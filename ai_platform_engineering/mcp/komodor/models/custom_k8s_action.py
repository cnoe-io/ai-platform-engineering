"""Model for Customk8saction"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Customk8saction(BaseModel):
  """Customk8saction model"""


class Customk8sactionResponse(APIResponse):
  """Response model for Customk8saction"""

  data: Optional[Customk8saction] = None


class Customk8sactionListResponse(APIResponse):
  """List response model for Customk8saction"""

  data: List[Customk8saction] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
