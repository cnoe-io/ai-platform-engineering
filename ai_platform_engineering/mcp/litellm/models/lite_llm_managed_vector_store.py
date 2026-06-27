"""Model for LitellmManagedvectorstore"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmManagedvectorstore(BaseModel):
  """LiteLLM managed vector store object - this is is the object stored in the database"""


class LitellmManagedvectorstoreResponse(APIResponse):
  """Response model for LitellmManagedvectorstore"""

  data: Optional[LitellmManagedvectorstore] = None


class LitellmManagedvectorstoreListResponse(APIResponse):
  """List response model for LitellmManagedvectorstore"""

  data: List[LitellmManagedvectorstore] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
