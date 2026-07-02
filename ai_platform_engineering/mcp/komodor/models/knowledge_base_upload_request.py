"""Model for Knowledgebaseuploadrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Knowledgebaseuploadrequest(BaseModel):
  """Knowledgebaseuploadrequest model"""


class KnowledgebaseuploadrequestResponse(APIResponse):
  """Response model for Knowledgebaseuploadrequest"""

  data: Optional[Knowledgebaseuploadrequest] = None


class KnowledgebaseuploadrequestListResponse(APIResponse):
  """List response model for Knowledgebaseuploadrequest"""

  data: List[Knowledgebaseuploadrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
