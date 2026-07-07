"""Model for Deploymentstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deploymentstatus(BaseModel):
  """The status of the deployment"""


class DeploymentstatusResponse(APIResponse):
  """Response model for Deploymentstatus"""

  data: Optional[Deploymentstatus] = None


class DeploymentstatusListResponse(APIResponse):
  """List response model for Deploymentstatus"""

  data: List[Deploymentstatus] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
