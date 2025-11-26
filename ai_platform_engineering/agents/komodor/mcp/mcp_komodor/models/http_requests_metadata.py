"""Model for Httprequestsmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Httprequestsmetadata(BaseModel):
  """Httprequestsmetadata model"""


class HttprequestsmetadataResponse(APIResponse):
  """Response model for Httprequestsmetadata"""

  data: Optional[Httprequestsmetadata] = None


class HttprequestsmetadataListResponse(APIResponse):
  """List response model for Httprequestsmetadata"""

  data: List[Httprequestsmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
