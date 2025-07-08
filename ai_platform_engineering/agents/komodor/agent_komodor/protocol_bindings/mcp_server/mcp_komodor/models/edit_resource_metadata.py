"""Model for Editresourcemetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Editresourcemetadata(BaseModel):
    """Editresourcemetadata model"""


class EditresourcemetadataResponse(APIResponse):
    """Response model for Editresourcemetadata"""

    data: Optional[Editresourcemetadata] = None


class EditresourcemetadataListResponse(APIResponse):
    """List response model for Editresourcemetadata"""

    data: List[Editresourcemetadata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
