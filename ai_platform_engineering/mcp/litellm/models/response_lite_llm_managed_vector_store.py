"""Model for ResponselitellmManagedvectorstore"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class ResponselitellmManagedvectorstore(BaseModel):
  """ResponselitellmManagedvectorstore model"""


class ResponselitellmManagedvectorstoreResponse(APIResponse):
  """Response model for ResponselitellmManagedvectorstore"""

  data: Optional[ResponselitellmManagedvectorstore] = None


class ResponselitellmManagedvectorstoreListResponse(APIResponse):
  """List response model for ResponselitellmManagedvectorstore"""

  data: List[ResponselitellmManagedvectorstore] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
