"""Model for Updateuserrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateuserrequest(BaseModel):
  """Updateuserrequest model"""


class UpdateuserrequestResponse(APIResponse):
  """Response model for Updateuserrequest"""

  data: Optional[Updateuserrequest] = None


class UpdateuserrequestListResponse(APIResponse):
  """List response model for Updateuserrequest"""

  data: List[Updateuserrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
