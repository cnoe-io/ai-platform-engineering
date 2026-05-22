"""Model for BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost(BaseModel):
  """BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost model"""


class BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPostResponse(APIResponse):
  """Response model for BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost"""

  data: Optional[BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost] = None


class BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPostListResponse(APIResponse):
  """List response model for BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost"""

  data: List[BodyConvertPromptFileToJsonUtilsDotpromptJsonConverterPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
