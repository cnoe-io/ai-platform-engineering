"""Model for Installhelmchartmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Installhelmchartmetadata(BaseModel):
  """Installhelmchartmetadata model"""


class InstallhelmchartmetadataResponse(APIResponse):
  """Response model for Installhelmchartmetadata"""

  data: Optional[Installhelmchartmetadata] = None


class InstallhelmchartmetadataListResponse(APIResponse):
  """List response model for Installhelmchartmetadata"""

  data: List[Installhelmchartmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
