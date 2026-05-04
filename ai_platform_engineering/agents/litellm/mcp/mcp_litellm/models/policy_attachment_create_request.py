"""Model for Policyattachmentcreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyattachmentcreaterequest(BaseModel):
  """Request body for creating a policy attachment."""


class PolicyattachmentcreaterequestResponse(APIResponse):
  """Response model for Policyattachmentcreaterequest"""

  data: Optional[Policyattachmentcreaterequest] = None


class PolicyattachmentcreaterequestListResponse(APIResponse):
  """List response model for Policyattachmentcreaterequest"""

  data: List[Policyattachmentcreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
