"""Model for Modelgroupinfoproxy"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Modelgroupinfoproxy(BaseModel):
  """Modelgroupinfoproxy model"""


class ModelgroupinfoproxyResponse(APIResponse):
  """Response model for Modelgroupinfoproxy"""

  data: Optional[Modelgroupinfoproxy] = None


class ModelgroupinfoproxyListResponse(APIResponse):
  """List response model for Modelgroupinfoproxy"""

  data: List[Modelgroupinfoproxy] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
