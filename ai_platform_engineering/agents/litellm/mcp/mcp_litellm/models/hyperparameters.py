"""Model for Hyperparameters"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Hyperparameters(BaseModel):
  """Hyperparameters model"""


class HyperparametersResponse(APIResponse):
  """Response model for Hyperparameters"""

  data: Optional[Hyperparameters] = None


class HyperparametersListResponse(APIResponse):
  """List response model for Hyperparameters"""

  data: List[Hyperparameters] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
