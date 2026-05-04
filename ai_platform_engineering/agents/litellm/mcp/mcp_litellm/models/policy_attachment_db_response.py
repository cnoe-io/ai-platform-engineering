"""Model for Policyattachmentdbresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyattachmentdbresponse(BaseModel):
  """Response for a policy attachment from the database."""


class PolicyattachmentdbresponseResponse(APIResponse):
  """Response model for Policyattachmentdbresponse"""

  data: Optional[Policyattachmentdbresponse] = None


class PolicyattachmentdbresponseListResponse(APIResponse):
  """List response model for Policyattachmentdbresponse"""

  data: List[Policyattachmentdbresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
