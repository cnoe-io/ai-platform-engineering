"""Model for BodyUploadLogoUploadLogoPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyUploadLogoUploadLogoPost(BaseModel):
  """BodyUploadLogoUploadLogoPost model"""


class BodyUploadLogoUploadLogoPostResponse(APIResponse):
  """Response model for BodyUploadLogoUploadLogoPost"""

  data: Optional[BodyUploadLogoUploadLogoPost] = None


class BodyUploadLogoUploadLogoPostListResponse(APIResponse):
  """List response model for BodyUploadLogoUploadLogoPost"""

  data: List[BodyUploadLogoUploadLogoPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
