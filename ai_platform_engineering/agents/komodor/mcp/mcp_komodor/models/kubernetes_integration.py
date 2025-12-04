"""Model for Kubernetesintegration"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Kubernetesintegration(BaseModel):
  """Kubernetesintegration model"""


class KubernetesintegrationResponse(APIResponse):
  """Response model for Kubernetesintegration"""

  data: Optional[Kubernetesintegration] = None


class KubernetesintegrationListResponse(APIResponse):
  """List response model for Kubernetesintegration"""

  data: List[Kubernetesintegration] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
