"""Model for Contentfiltercategoryconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Contentfiltercategoryconfig(BaseModel):
  """category: "harmful_self_harm"
  enabled: true
  action: "BLOCK"
  severity_threshold: "medium"
  category_file: "/path/to/custom_file.yaml"  # optional override"""


class ContentfiltercategoryconfigResponse(APIResponse):
  """Response model for Contentfiltercategoryconfig"""

  data: Optional[Contentfiltercategoryconfig] = None


class ContentfiltercategoryconfigListResponse(APIResponse):
  """List response model for Contentfiltercategoryconfig"""

  data: List[Contentfiltercategoryconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
