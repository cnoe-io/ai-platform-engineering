"""Model for Createsearchtoolrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createsearchtoolrequest(BaseModel):
  """Createsearchtoolrequest model"""


class CreatesearchtoolrequestResponse(APIResponse):
  """Response model for Createsearchtoolrequest"""

  data: Optional[Createsearchtoolrequest] = None


class CreatesearchtoolrequestListResponse(APIResponse):
  """List response model for Createsearchtoolrequest"""

  data: List[Createsearchtoolrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
