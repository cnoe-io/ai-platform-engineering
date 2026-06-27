"""Model for Indexcreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Indexcreaterequest(BaseModel):
  """Indexcreaterequest model"""


class IndexcreaterequestResponse(APIResponse):
  """Response model for Indexcreaterequest"""

  data: Optional[Indexcreaterequest] = None


class IndexcreaterequestListResponse(APIResponse):
  """List response model for Indexcreaterequest"""

  data: List[Indexcreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
