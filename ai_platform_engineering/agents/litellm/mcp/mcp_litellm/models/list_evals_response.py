"""Model for Listevalsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listevalsresponse(BaseModel):
  """Response from listing evaluations"""


class ListevalsresponseResponse(APIResponse):
  """Response model for Listevalsresponse"""

  data: Optional[Listevalsresponse] = None


class ListevalsresponseListResponse(APIResponse):
  """List response model for Listevalsresponse"""

  data: List[Listevalsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
