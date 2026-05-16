"""Model for BodyAudioTranscriptionsAudioTranscriptionsPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyAudioTranscriptionsAudioTranscriptionsPost(BaseModel):
  """BodyAudioTranscriptionsAudioTranscriptionsPost model"""


class BodyAudioTranscriptionsAudioTranscriptionsPostResponse(APIResponse):
  """Response model for BodyAudioTranscriptionsAudioTranscriptionsPost"""

  data: Optional[BodyAudioTranscriptionsAudioTranscriptionsPost] = None


class BodyAudioTranscriptionsAudioTranscriptionsPostListResponse(APIResponse):
  """List response model for BodyAudioTranscriptionsAudioTranscriptionsPost"""

  data: List[BodyAudioTranscriptionsAudioTranscriptionsPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
