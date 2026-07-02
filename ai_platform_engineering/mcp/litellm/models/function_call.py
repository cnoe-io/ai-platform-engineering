"""Model for Functioncall"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Functioncall(BaseModel):
  """Functioncall model"""


class FunctioncallResponse(APIResponse):
  """Response model for Functioncall"""

  data: Optional[Functioncall] = None


class FunctioncallListResponse(APIResponse):
  """List response model for Functioncall"""

  data: List[Functioncall] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
