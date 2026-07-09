"""Model for Createkubernetesintegrationrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createkubernetesintegrationrequest(BaseModel):
  """Createkubernetesintegrationrequest model"""


class CreatekubernetesintegrationrequestResponse(APIResponse):
  """Response model for Createkubernetesintegrationrequest"""

  data: Optional[Createkubernetesintegrationrequest] = None


class CreatekubernetesintegrationrequestListResponse(APIResponse):
  """List response model for Createkubernetesintegrationrequest"""

  data: List[Createkubernetesintegrationrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
