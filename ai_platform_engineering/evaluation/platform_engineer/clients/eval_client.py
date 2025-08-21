"""
Evaluation client for communicating with Platform Engineer via A2A protocol.
"""
import asyncio
import logging
import time
import uuid
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

import httpx
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import SendMessageRequest, MessageSendParams, AgentCard
from langfuse import Langfuse

logger = logging.getLogger(__name__)


@dataclass
class EvaluationRequest:
    """Represents a single evaluation request."""
    prompt: str
    expected_agents: List[str]
    category: str
    operation: str
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
        langfuse_host: str = "http://langfuse-web:3000",
        langfuse_public_key: str = None,
        langfuse_secret_key: str = None,
        timeout: float = 300.0
    ):
        self.platform_engineer_url = platform_engineer_url
        self.timeout = timeout
        
        # Initialize Langfuse client
        self.langfuse = None
        if langfuse_public_key and langfuse_secret_key:
            self.langfuse = Langfuse(
                public_key=langfuse_public_key,
                secret_key=langfuse_secret_key,
                host=langfuse_host
            )
        
        # A2A client components
        self.httpx_client = None
        self.agent_card = None
        self.a2a_client = None
        
    async def initialize(self):
        """Initialize A2A client connection to Platform Engineer."""
        logger.info(f"Initializing A2A connection to Platform Engineer: {self.platform_engineer_url}")
        
        self.httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(self.timeout))
        
        try:
            # Get Platform Engineer agent card
            resolver = A2ACardResolver(
                httpx_client=self.httpx_client,
                base_url=self.platform_engineer_url
            )
            
            self.agent_card = await resolver.get_agent_card()
            logger.info(f"Successfully fetched Platform Engineer agent card: {self.agent_card.name}")
            
            # Override the agent card URL with our configured URL to avoid localhost issues
            self.agent_card.url = self.platform_engineer_url
            logger.info(f"Overriding agent card URL to: {self.platform_engineer_url}")
            
            # Initialize A2A client
            self.a2a_client = A2AClient(
                httpx_client=self.httpx_client,
                agent_card=self.agent_card
            )
            
            logger.info("A2A client initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize A2A client: {e}")
            raise RuntimeError(f"Could not connect to Platform Engineer at {self.platform_engineer_url}") from e
    
    async def evaluate_single_prompt(self, request: EvaluationRequest) -> EvaluationResponse:
        """Evaluate a single prompt using the Platform Engineer."""
        if not self.a2a_client:
            await self.initialize()
        
        # Generate trace ID if not provided
        if not request.trace_id:
            request.trace_id = str(uuid.uuid4()).replace('-', '').lower()
        
        logger.info(f"Evaluating prompt: {request.prompt[:100]}... (trace_id: {request.trace_id})")
        
        start_time = time.time()
        
        try:
            # Build A2A message with trace metadata
            message_payload = {
                'role': 'user',
                'parts': [
                    {'kind': 'text', 'text': request.prompt}
                ],
                'messageId': uuid.uuid4().hex,
                'metadata': {
                    'trace_id': request.trace_id,
                    'category': request.category,
                    'operation': request.operation,
                    'source': 'langfuse_evaluation',
                    'langfuse_trace_id': request.trace_id,
                    'enable_tracing': True,
                    **(request.metadata or {})
                }
            }
            
            # Create SendMessageRequest
            send_request = SendMessageRequest(
                id=str(uuid.uuid4()),
                params=MessageSendParams(message=message_payload)
            )
            
            logger.info(f"Sending A2A message to Platform Engineer (trace_id: {request.trace_id})")
            
            # Send message and await response
            response = await self.a2a_client.send_message(send_request)
            
            execution_time = time.time() - start_time
            
            # Extract response text
            response_text = self._extract_response_text(response)
            
            logger.info(f"Received response from Platform Engineer (trace_id: {request.trace_id}, time: {execution_time:.2f}s)")
            
            return EvaluationResponse(
                response_text=response_text,
                trace_id=request.trace_id,
                success=True,
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            error_msg = f"Evaluation failed: {str(e)}"
            logger.error(f"{error_msg} (trace_id: {request.trace_id})")
            
            return EvaluationResponse(
                response_text="",
                trace_id=request.trace_id,
                success=False,
                execution_time=execution_time,
                error_message=error_msg
            )
    
    def _extract_response_text(self, response) -> str:
        """Extract text content from A2A response."""
        try:
            # Check for successful result
            if hasattr(response, 'root') and hasattr(response.root, 'result') and response.root.result:
                if hasattr(response.root.result, 'artifacts') and response.root.result.artifacts:
                    texts = []
                    for artifact in response.root.result.artifacts:
                        if hasattr(artifact, 'parts'):
                            for part in artifact.parts:
                                if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                    texts.append(part.root.text)
                    
                    return " ".join(texts) if texts else ""
            
            # Check for error
            if hasattr(response, 'root') and hasattr(response.root, 'error') and response.root.error:
                error_msg = response.root.error.message
                logger.error(f"A2A error response: {error_msg}")
                raise Exception(f"Platform Engineer error: {error_msg}")
            
            # If we get here, try to extract any available text from the response
            logger.warning("Unexpected response structure, attempting fallback extraction")
            response_str = str(response)
            if len(response_str) > 100:
                return f"Platform Engineer response: {response_str[:100]}..."
            return response_str
                
        except Exception as e:
            logger.error(f"Failed to extract response text: {e}")
            raise
    
    async def evaluate_batch(
        self, 
        requests: List[EvaluationRequest],
        max_concurrent: int = 5
    ) -> List[EvaluationResponse]:
        """Evaluate a batch of prompts with controlled concurrency."""
        logger.info(f"Starting batch evaluation of {len(requests)} prompts (max_concurrent: {max_concurrent})")
        
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def evaluate_with_semaphore(request: EvaluationRequest) -> EvaluationResponse:
            async with semaphore:
                return await self.evaluate_single_prompt(request)
        
        # Execute evaluations concurrently
        tasks = [evaluate_with_semaphore(req) for req in requests]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Convert exceptions to error responses
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Batch evaluation failed for request {i}: {result}")
                final_results.append(EvaluationResponse(
                    response_text="",
                    trace_id=requests[i].trace_id or "unknown",
                    success=False,
                    execution_time=0.0,
                    error_message=str(result)
                ))
            else:
                final_results.append(result)
        
        successful = sum(1 for r in final_results if r.success)
        logger.info(f"Batch evaluation completed: {successful}/{len(final_results)} successful")
        
        return final_results
    
    async def health_check(self) -> bool:
        """Check if Platform Engineer is accessible via A2A."""
        try:
            # Reinitialize if client was closed
            if not self.httpx_client or self.httpx_client.is_closed:
                self.httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
            
            resolver = A2ACardResolver(
                httpx_client=self.httpx_client,
                base_url=self.platform_engineer_url
            )
            
            card = await resolver.get_agent_card()
            logger.info(f"Health check successful - Platform Engineer available: {card.name}")
            return True
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False
    
    async def close(self):
        """Clean up resources."""
        if self.httpx_client:
            await self.httpx_client.aclose()
            logger.info("Evaluation client resources cleaned up")
    
    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()