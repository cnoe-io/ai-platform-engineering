"""Model for Teammodeladdrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammodeladdrequest(BaseModel):
  """Request to add models to a team"""


class TeammodeladdrequestResponse(APIResponse):
  """Response model for Teammodeladdrequest"""

  data: Optional[Teammodeladdrequest] = None


class TeammodeladdrequestListResponse(APIResponse):
  """List response model for Teammodeladdrequest"""

  data: List[Teammodeladdrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
