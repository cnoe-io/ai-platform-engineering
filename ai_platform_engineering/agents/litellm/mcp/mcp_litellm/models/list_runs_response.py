"""Model for Listrunsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listrunsresponse(BaseModel):
  """Response from listing runs"""


class ListrunsresponseResponse(APIResponse):
  """Response model for Listrunsresponse"""

  data: Optional[Listrunsresponse] = None


class ListrunsresponseListResponse(APIResponse):
  """List response model for Listrunsresponse"""

  data: List[Listrunsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
