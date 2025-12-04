"""Model for Kubernetesrbacpolicyrule"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Kubernetesrbacpolicyrule(BaseModel):
  """Kubernetesrbacpolicyrule model"""


class KubernetesrbacpolicyruleResponse(APIResponse):
  """Response model for Kubernetesrbacpolicyrule"""

  data: Optional[Kubernetesrbacpolicyrule] = None


class KubernetesrbacpolicyruleListResponse(APIResponse):
  """List response model for Kubernetesrbacpolicyrule"""

  data: List[Kubernetesrbacpolicyrule] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
