"""Model for Updatedeployment"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatedeployment(BaseModel):
  """Updatedeployment model"""


class UpdatedeploymentResponse(APIResponse):
  """Response model for Updatedeployment"""

  data: Optional[Updatedeployment] = None


class UpdatedeploymentListResponse(APIResponse):
  """List response model for Updatedeployment"""

  data: List[Updatedeployment] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
