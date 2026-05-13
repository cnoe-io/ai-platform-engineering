"""Model for Attachmentimpactresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Attachmentimpactresponse(BaseModel):
  """Response for estimating the impact of a policy attachment."""


class AttachmentimpactresponseResponse(APIResponse):
  """Response model for Attachmentimpactresponse"""

  data: Optional[Attachmentimpactresponse] = None


class AttachmentimpactresponseListResponse(APIResponse):
  """List response model for Attachmentimpactresponse"""

  data: List[Attachmentimpactresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
