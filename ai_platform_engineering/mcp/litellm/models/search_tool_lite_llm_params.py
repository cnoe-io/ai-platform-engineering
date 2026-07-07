"""Model for Searchtoollitellmparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchtoollitellmparams(BaseModel):
  """LiteLLM params for search tools configuration."""


class SearchtoollitellmparamsResponse(APIResponse):
  """Response model for Searchtoollitellmparams"""

  data: Optional[Searchtoollitellmparams] = None


class SearchtoollitellmparamsListResponse(APIResponse):
  """List response model for Searchtoollitellmparams"""

  data: List[Searchtoollitellmparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
