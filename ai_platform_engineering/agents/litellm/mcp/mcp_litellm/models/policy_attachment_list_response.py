"""Model for Policyattachmentlistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyattachmentlistresponse(BaseModel):
  """Response for listing policy attachments."""


class PolicyattachmentlistresponseResponse(APIResponse):
  """Response model for Policyattachmentlistresponse"""

  data: Optional[Policyattachmentlistresponse] = None


class PolicyattachmentlistresponseListResponse(APIResponse):
  """List response model for Policyattachmentlistresponse"""

  data: List[Policyattachmentlistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
