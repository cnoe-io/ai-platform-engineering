"""
Evaluation client for communicating with Platform Engineer via A2A protocol.
Extracted from runner.py to provide better separation of concerns.
"""
import asyncio
import logging
import time
import uuid
from typing import Optional, Dict, Any
from dataclasses import dataclass

import httpx
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import SendMessageRequest, MessageSendParams, Message, TextPart, Role

logger = logging.getLogger(__name__)


@dataclass
class EvaluationRequest:
    """Represents a single evaluation request."""
    prompt: str
    trace_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class EvaluationResponse:
    """Represents the response from Platform Engineer."""
    response_text: str
    trace_id: str
    success: bool
    execution_time: float
    error_message: Optional[str] = None


class EvalClient:
    """A2A protocol client for sending evaluation requests to Platform Engineer."""

    def __init__(
        self,
        platform_engineer_url: str = "http://platform-engineering:8000",
        timeout: float = 300.0,
        max_concurrent_requests: int = 3
    ):
        self.platform_engineer_url = platform_engineer_url
        self.timeout = timeout
        
        # Rate limiting to prevent overwhelming the Platform Engineer
        self._request_semaphore = asyncio.Semaphore(max_concurrent_requests)
        
        # A2A client components
        self.httpx_client = None
        self.a2a_client = None
        
    async def initialize(self):
        """Initialize A2A client for communicating with Platform Engineer."""
        logger.info(f"🔍 EvalClient: Initializing A2A connection to Platform Engineer: {self.platform_engineer_url}")
        
        self.httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(self.timeout))
        
        try:
            # Get Platform Engineer agent card
            resolver = A2ACardResolver(
                httpx_client=self.httpx_client,
                base_url=self.platform_engineer_url
            )
            
            agent_card = await resolver.get_agent_card()
            logger.info(f"🔍 EvalClient: Connected to Platform Engineer: {agent_card.name}")
            
            # Create A2A client
            # Note: A2A client prioritizes agent_card.url over the url parameter
            # So we provide only the url parameter to override the localhost URL
            self.a2a_client = A2AClient(
                httpx_client=self.httpx_client,
                url=self.platform_engineer_url  # Use correct URL for container communication
            )
            
            logger.info("🔍 EvalClient: A2A client initialized successfully")
            
        except Exception as e:
            logger.error(f"🔍 EvalClient: Failed to initialize A2A client: {e}")
            raise
    
    async def send_message(self, request: EvaluationRequest) -> EvaluationResponse:
        """Send evaluation request to Platform Engineer and get response."""
        if not self.a2a_client:
            await self.initialize()
        
        start_time = time.time()
        
        # Rate limiting to prevent queue overload
        async with self._request_semaphore:
            try:
                # Create a proper Message object with TextPart content and trace_id in metadata
                message = Message(
                    message_id=str(uuid.uuid4()),
                    role=Role.user,
                    parts=[TextPart(text=request.prompt)],
                    context_id=str(uuid.uuid4()),
                    metadata={"trace_id": request.trace_id} if request.trace_id else None
                )
                
                # Create properly structured request
                a2a_request = SendMessageRequest(
                    id=str(uuid.uuid4()),
                    params=MessageSendParams(
                        message=message
                    )
                )
                
                logger.info(f"🔍 EvalClient A2A Request: Sending trace_id={request.trace_id} to Platform Engineer")
                
                # Send message and get single response (not streaming)
                response = await self.a2a_client.send_message(a2a_request)
                
                execution_time = time.time() - start_time
                
                # Extract content from response
                response_text = self._extract_response_text(response)
                
                logger.info(f"🔍 EvalClient: Received response from Platform Engineer (trace_id: {request.trace_id}, time: {execution_time:.2f}s)")
                
                return EvaluationResponse(
                    response_text=response_text,
                    trace_id=request.trace_id or "unknown",
                    success=True,
                    execution_time=execution_time
                )
                
            except Exception as e:
                execution_time = time.time() - start_time
                error_msg = f"Failed to send message to Platform Engineer: {str(e)}"
                logger.error(f"🔍 EvalClient: {error_msg}")
                
                return EvaluationResponse(
                    response_text=error_msg,
                    trace_id=request.trace_id or "unknown", 
                    success=False,
                    execution_time=execution_time,
                    error_message=error_msg
                )
    
    def _extract_response_text(self, response) -> str:
        """Extract content from A2A response."""
        # Extract content from response (same logic as original)
        if hasattr(response, 'content'):
            return response.content
        elif hasattr(response, 'message') and hasattr(response.message, 'content'):
            return response.message.content
        elif isinstance(response, dict):
            return response.get('content', str(response))
        else:
            return str(response)
    
    async def cleanup(self):
        """Clean up A2A client resources."""
        if self.httpx_client:
            await self.httpx_client.aclose()
            logger.info("🔍 EvalClient: Cleaned up A2A client resources")