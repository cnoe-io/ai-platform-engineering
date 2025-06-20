# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging
from typing import Optional

from phoenix.otel import register
from openinference.instrumentation.langchain import LangChainInstrumentor
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.util.types import Attributes

logger = logging.getLogger(__name__)

class FilteringSpanProcessor(BatchSpanProcessor):
    """Custom span processor that filters out noisy A2A internal spans."""
    
    def __init__(self, span_exporter, **kwargs):
        super().__init__(span_exporter, **kwargs)
        
        # Define patterns for spans to filter out
        self.filtered_patterns = [
            # A2A Server Events (internal queue operations)
            "a2a.server.events.event_queue",
            "a2a.server.events.in_memory_queue_manager", 
            "a2a.server.events.event_consumer",
            
            # A2A Server Request Handlers (HTTP/JSONRPC layer)
            "a2a.server.request_handlers.jsonrpc_handler",
            "a2a.server.request_handlers.default_request_handler",
            "JSONRPCHandler.on_message_send",
            "DefaultRequestHandler.on_m",
            "DefaultRequestHandler._",
            # Exact matches from the trace
            "a2a.server.request_handlers.jsonrpc_handler.JSONRPCHandler.on_message_send",
            "a2a.server.request_handlers.default_request_handler.DefaultRequestHandler.on_m",
            "a2a.server.request_handlers.default_request_handler.DefaultRequestHandler._",
            
            # A2A Utils and Internal Operations
            "a2a.utils.helpers",
            ".task_done",
            ".close",
            ".dequeue_event",
            ".enqueue_event",
            "_cleanup_producer",
            "_register_producer"
        ]
    
    def on_end(self, span):
        """Filter spans before sending to exporter."""
        span_name = span.name
        
        # Filter out noisy A2A internal operations
        for pattern in self.filtered_patterns:
            if pattern in span_name:
                logger.debug(f"🚫 Filtering out span: {span_name} (matched pattern: {pattern})")
                return  # Skip this span
        
        # Keep important spans
        logger.debug(f"✅ Keeping span: {span_name}")
        super().on_end(span)

class PhoenixTracing:
    """Phoenix tracing setup and management for AI Platform Engineering."""
    
    _initialized = False
    _tracer = None
    
    @classmethod
    def initialize(cls, project_name: str = "ai-platform-engineering") -> None:
        """Initialize Phoenix tracing with automatic instrumentation."""
        if cls._initialized:
            logger.info("Phoenix tracing already initialized")
            return
            
        try:
            # Get Phoenix collector endpoint from environment
            phoenix_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "http://localhost:6006")
            
            logger.info(f"Initializing Phoenix tracing with endpoint: {phoenix_endpoint}")
            
            # Manually configure OTLP exporter since Phoenix register() is sending to wrong endpoint
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            
            # Set up TracerProvider and OTLP exporter manually
            tracer_provider = TracerProvider()
            
            # Configure OTLP exporter with correct endpoint
            otlp_exporter = OTLPSpanExporter(
                endpoint=f"{phoenix_endpoint}/v1/traces",
                headers={}
            )
            
            # Add span processor (filtered or unfiltered based on config)
            filter_noisy_spans = os.getenv("PHOENIX_FILTER_NOISY_SPANS", "true").lower() == "true"
            if filter_noisy_spans:
                span_processor = FilteringSpanProcessor(otlp_exporter)
                logger.info("Using filtered span processor to reduce A2A internal noise")
            else:
                span_processor = BatchSpanProcessor(otlp_exporter)
                logger.info("Using unfiltered span processor - all spans will be sent")
            tracer_provider.add_span_processor(span_processor)
            
            # Set as global tracer provider
            trace.set_tracer_provider(tracer_provider)
            
            logger.info(f"Manual OTLP setup complete - sending to {phoenix_endpoint}/v1/traces")
            
            # Auto-instrument LangChain/LangGraph components
            LangChainInstrumentor().instrument()
            logger.info("LangChain instrumentation enabled")
            
            # Auto-instrument HTTP/HTTPX requests (for A2A calls)
            # HTTPXInstrumentor().instrument()  # Package not available
            logger.info("HTTPX instrumentation skipped - package not available")
            
            # Get tracer for manual span creation
            cls._tracer = trace.get_tracer(__name__)
            
            cls._initialized = True
            logger.info("Phoenix tracing initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Phoenix tracing: {e}")
            raise
    
    @classmethod
    def get_tracer(cls):
        """Get the OpenTelemetry tracer instance."""
        if not cls._initialized:
            cls.initialize()
        return cls._tracer
    
    @classmethod
    def create_span(cls, name: str, attributes: Optional[dict] = None):
        """Create a new span with optional attributes."""
        tracer = cls.get_tracer()
        span = tracer.start_span(name)
        
        if attributes:
            for key, value in attributes.items():
                span.set_attribute(key, str(value))
                
        return span
    
    @classmethod
    def add_span_attributes(cls, span, attributes: dict):
        """Add attributes to an existing span."""
        for key, value in attributes.items():
            span.set_attribute(key, str(value))
    
    @classmethod
    def is_initialized(cls) -> bool:
        """Check if tracing is initialized."""
        return cls._initialized


def setup_phoenix_tracing(project_name: str = "ai-platform-engineering") -> None:
    """Convenience function to setup Phoenix tracing."""
    PhoenixTracing.initialize(project_name)


def get_current_trace_id() -> Optional[str]:
    """Get the current trace ID for correlation."""
    try:
        current_span = trace.get_current_span()
        if current_span and current_span.is_recording():
            return format(current_span.get_span_context().trace_id, "032x")
    except Exception:
        pass
    return None


def get_current_span_id() -> Optional[str]:
    """Get the current span ID for correlation."""
    try:
        current_span = trace.get_current_span()
        if current_span and current_span.is_recording():
            return format(current_span.get_span_context().span_id, "016x")
    except Exception:
        pass
    return None