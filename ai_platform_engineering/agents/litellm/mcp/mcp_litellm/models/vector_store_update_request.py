"""Model for Vectorstoreupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vectorstoreupdaterequest(BaseModel):
  """Vectorstoreupdaterequest model"""


class VectorstoreupdaterequestResponse(APIResponse):
  """Response model for Vectorstoreupdaterequest"""

  data: Optional[Vectorstoreupdaterequest] = None


class VectorstoreupdaterequestListResponse(APIResponse):
  """List response model for Vectorstoreupdaterequest"""

  data: List[Vectorstoreupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
