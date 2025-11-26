"""Model for Cronjobrunnowmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cronjobrunnowmetadata(BaseModel):
  """Cronjobrunnowmetadata model"""


class CronjobrunnowmetadataResponse(APIResponse):
  """Response model for Cronjobrunnowmetadata"""

  data: Optional[Cronjobrunnowmetadata] = None


class CronjobrunnowmetadataListResponse(APIResponse):
  """List response model for Cronjobrunnowmetadata"""

  data: List[Cronjobrunnowmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
