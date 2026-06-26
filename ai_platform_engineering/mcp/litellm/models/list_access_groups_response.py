"""Model for Listaccessgroupsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listaccessgroupsresponse(BaseModel):
  """Listaccessgroupsresponse model"""


class ListaccessgroupsresponseResponse(APIResponse):
  """Response model for Listaccessgroupsresponse"""

  data: Optional[Listaccessgroupsresponse] = None


class ListaccessgroupsresponseListResponse(APIResponse):
  """List response model for Listaccessgroupsresponse"""

  data: List[Listaccessgroupsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
