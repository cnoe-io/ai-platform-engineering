# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

"""Model for User"""

from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo

class User(BaseModel):
    """User model"""

    id: Optional[int] = None
    username: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    phone: Optional[str] = None
    userStatus: Optional[int] = None
    """User Status"""

class UserResponse(APIResponse):
    """Response model for User"""
    data: Optional[User] = None

class UserListResponse(APIResponse):
    """List response model for User"""
    data: List[User] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
