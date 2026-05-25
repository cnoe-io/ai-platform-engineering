"""Model for Modelinfodelete"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Modelinfodelete(BaseModel):
  """Modelinfodelete model"""


class ModelinfodeleteResponse(APIResponse):
  """Response model for Modelinfodelete"""

  data: Optional[Modelinfodelete] = None


class ModelinfodeleteListResponse(APIResponse):
  """List response model for Modelinfodelete"""

  data: List[Modelinfodelete] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
