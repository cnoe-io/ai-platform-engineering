"""Model for Deployment"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deployment(BaseModel):
  """Deployment model"""


class DeploymentResponse(APIResponse):
  """Response model for Deployment"""

  data: Optional[Deployment] = None


class DeploymentListResponse(APIResponse):
  """List response model for Deployment"""

  data: List[Deployment] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
