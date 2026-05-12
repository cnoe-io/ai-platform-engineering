"""Model for Updateusefullinksrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateusefullinksrequest(BaseModel):
  """Updateusefullinksrequest model"""


class UpdateusefullinksrequestResponse(APIResponse):
  """Response model for Updateusefullinksrequest"""

  data: Optional[Updateusefullinksrequest] = None


class UpdateusefullinksrequestListResponse(APIResponse):
  """List response model for Updateusefullinksrequest"""

  data: List[Updateusefullinksrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
