"""Model for Enrichtemplaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Enrichtemplaterequest(BaseModel):
  """Enrichtemplaterequest model"""


class EnrichtemplaterequestResponse(APIResponse):
  """Response model for Enrichtemplaterequest"""

  data: Optional[Enrichtemplaterequest] = None


class EnrichtemplaterequestListResponse(APIResponse):
  """List response model for Enrichtemplaterequest"""

  data: List[Enrichtemplaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
