"""Model for BodyAudioTranscriptionsV1AudioTranscriptionsPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyAudioTranscriptionsV1AudioTranscriptionsPost(BaseModel):
  """BodyAudioTranscriptionsV1AudioTranscriptionsPost model"""


class BodyAudioTranscriptionsV1AudioTranscriptionsPostResponse(APIResponse):
  """Response model for BodyAudioTranscriptionsV1AudioTranscriptionsPost"""

  data: Optional[BodyAudioTranscriptionsV1AudioTranscriptionsPost] = None


class BodyAudioTranscriptionsV1AudioTranscriptionsPostListResponse(APIResponse):
  """List response model for BodyAudioTranscriptionsV1AudioTranscriptionsPost"""

  data: List[BodyAudioTranscriptionsV1AudioTranscriptionsPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
