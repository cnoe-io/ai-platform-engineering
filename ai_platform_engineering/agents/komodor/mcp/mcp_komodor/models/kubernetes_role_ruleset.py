"""Model for Kubernetesroleruleset"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Kubernetesroleruleset(BaseModel):
  """Kubernetesroleruleset model"""


class KubernetesrolerulesetResponse(APIResponse):
  """Response model for Kubernetesroleruleset"""

  data: Optional[Kubernetesroleruleset] = None


class KubernetesrolerulesetListResponse(APIResponse):
  """List response model for Kubernetesroleruleset"""

  data: List[Kubernetesroleruleset] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
