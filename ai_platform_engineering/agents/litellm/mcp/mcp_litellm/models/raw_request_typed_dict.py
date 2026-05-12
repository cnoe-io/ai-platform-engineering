"""Model for Rawrequesttypeddict"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rawrequesttypeddict(BaseModel):
  """Rawrequesttypeddict model"""


class RawrequesttypeddictResponse(APIResponse):
  """Response model for Rawrequesttypeddict"""

  data: Optional[Rawrequesttypeddict] = None


class RawrequesttypeddictListResponse(APIResponse):
  """List response model for Rawrequesttypeddict"""

  data: List[Rawrequesttypeddict] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
