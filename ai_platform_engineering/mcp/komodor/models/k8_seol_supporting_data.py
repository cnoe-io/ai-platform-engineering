"""Model for K8seolsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class K8seolsupportingdata(BaseModel):
  """K8seolsupportingdata model"""


class K8seolsupportingdataResponse(APIResponse):
  """Response model for K8seolsupportingdata"""

  data: Optional[K8seolsupportingdata] = None


class K8seolsupportingdataListResponse(APIResponse):
  """List response model for K8seolsupportingdata"""

  data: List[K8seolsupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
