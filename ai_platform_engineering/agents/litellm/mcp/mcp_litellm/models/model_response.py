"""Model for Modelresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Modelresponse(BaseModel):
  """Modelresponse model"""


class ModelresponseResponse(APIResponse):
  """Response model for Modelresponse"""

  data: Optional[Modelresponse] = None


class ModelresponseListResponse(APIResponse):
  """List response model for Modelresponse"""

  data: List[Modelresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
