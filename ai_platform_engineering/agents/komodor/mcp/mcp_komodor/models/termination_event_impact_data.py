"""Model for Terminationeventimpactdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Terminationeventimpactdata(BaseModel):
  """Terminationeventimpactdata model"""


class TerminationeventimpactdataResponse(APIResponse):
  """Response model for Terminationeventimpactdata"""

  data: Optional[Terminationeventimpactdata] = None


class TerminationeventimpactdataListResponse(APIResponse):
  """List response model for Terminationeventimpactdata"""

  data: List[Terminationeventimpactdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
