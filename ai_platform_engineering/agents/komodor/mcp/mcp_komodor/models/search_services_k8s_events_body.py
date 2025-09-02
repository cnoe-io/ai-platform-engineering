"""Model for Searchservicesk8seventsbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchservicesk8seventsbody(BaseModel):
    """Searchservicesk8seventsbody model"""


class Searchservicesk8seventsbodyResponse(APIResponse):
    """Response model for Searchservicesk8seventsbody"""

    data: Optional[Searchservicesk8seventsbody] = None


class Searchservicesk8seventsbodyListResponse(APIResponse):
    """List response model for Searchservicesk8seventsbody"""

    data: List[Searchservicesk8seventsbody] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
