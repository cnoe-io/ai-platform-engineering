"""Model for Updatesearchtoolrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatesearchtoolrequest(BaseModel):
  """Updatesearchtoolrequest model"""


class UpdatesearchtoolrequestResponse(APIResponse):
  """Response model for Updatesearchtoolrequest"""

  data: Optional[Updatesearchtoolrequest] = None


class UpdatesearchtoolrequestListResponse(APIResponse):
  """List response model for Updatesearchtoolrequest"""

  data: List[Updatesearchtoolrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
