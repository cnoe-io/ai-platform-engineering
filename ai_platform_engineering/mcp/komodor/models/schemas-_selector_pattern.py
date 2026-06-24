"""Model for SchemasSelectorpattern"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class SchemasSelectorpattern(BaseModel):
  """SchemasSelectorpattern model"""


class SchemasSelectorpatternResponse(APIResponse):
  """Response model for SchemasSelectorpattern"""

  data: Optional[SchemasSelectorpattern] = None


class SchemasSelectorpatternListResponse(APIResponse):
  """List response model for SchemasSelectorpattern"""

  data: List[SchemasSelectorpattern] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
