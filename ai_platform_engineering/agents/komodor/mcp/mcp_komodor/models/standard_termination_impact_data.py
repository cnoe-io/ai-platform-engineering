"""Model for Standardterminationimpactdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Standardterminationimpactdata(BaseModel):
  """Standardterminationimpactdata model"""


class StandardterminationimpactdataResponse(APIResponse):
  """Response model for Standardterminationimpactdata"""

  data: Optional[Standardterminationimpactdata] = None


class StandardterminationimpactdataListResponse(APIResponse):
  """List response model for Standardterminationimpactdata"""

  data: List[Standardterminationimpactdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
