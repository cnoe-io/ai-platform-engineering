"""Model for Modelinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Modelinfo(BaseModel):
  """Modelinfo model"""


class ModelinfoResponse(APIResponse):
  """Response model for Modelinfo"""

  data: Optional[Modelinfo] = None


class ModelinfoListResponse(APIResponse):
  """List response model for Modelinfo"""

  data: List[Modelinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
