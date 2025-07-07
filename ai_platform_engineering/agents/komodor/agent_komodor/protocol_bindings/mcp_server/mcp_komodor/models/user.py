"""Model for User"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class User(BaseModel):
    """User model"""


class UserResponse(APIResponse):
    """Response model for User"""

    data: Optional[User] = None


class UserListResponse(APIResponse):
    """List response model for User"""

    data: List[User] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
