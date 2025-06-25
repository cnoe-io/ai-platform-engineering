# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging
from typing import Optional

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXInstrumentor
from opentelemetry.trace import Status, StatusCode, Span
# from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

logger = logging.getLogger(__name__)


class CleanSpanProcessor(SpanProcessor):
    """Custom span processor to filter noise and create clean trajectory graphs."""
    
    def __init__(self, next_processor: SpanProcessor):
        self.next_processor = next_processor
        self.noise_patterns = [
            "GET /health", "POST /metrics", "GET /ready",
            "token_refresh", "heartbeat", "background_task",
            "auth_refresh", "keepalive", "prometheus",
            "health_check", "metrics_collection"
        ]
        self.filter_enabled = os.getenv("PHOENIX_FILTER_HEALTH_CHECKS", "true").lower() == "true"
        self.user_requests_only = os.getenv("PHOENIX_TRACE_USER_REQUESTS_ONLY", "false").lower() == "true"
    
    def on_start(self, span: Span, parent_context=None) -> None:
        """Filter noisy spans before they reach Phoenix."""
        if self.filter_enabled and self._is_noise(span.name):
            # Mark span as unset to filter it out
            span.set_status(Status(StatusCode.UNSET))
            return
            
        # Standardize span names for clean visualization
        span.update_name(self._standardize_span_name(span.name))
        
        # Limit span attributes to essential ones only
        self._limit_span_attributes(span)
        
        if self.next_processor:
            self.next_processor.on_start(span, parent_context)
    
    def on_end(self, span: Span) -> None:
        """Process span on completion."""
        if self.next_processor:
            self.next_processor.on_end(span)
    
    def shutdown(self) -> bool:
        """Shutdown the processor."""
        if self.next_processor:
            return self.next_processor.shutdown()
        return True
    
    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """Force flush spans."""
        if self.next_processor:
            return self.next_processor.force_flush(timeout_millis)
        return True
    
    def _is_noise(self, span_name: str) -> bool:
        """Check if span should be filtered as noise."""
        return any(pattern in span_name.lower() for pattern in self.noise_patterns)
    
    def _standardize_span_name(self, span_name: str) -> str:
        """Standardize span names for clean visualization."""
        # Map common patterns to clean names
        name_mappings = {
            "HTTP POST": "http_request",
            "HTTP GET": "http_request", 
            "LLMChain": "llm_completion",
            "create_react_agent": "agent_execution",
            "supervisor": "supervisor_decision"
        }
        
        for pattern, clean_name in name_mappings.items():
            if pattern in span_name:
                return clean_name
                
        return span_name
    
    def _limit_span_attributes(self, span: Span) -> None:
        """Limit span attributes to essential ones for clean traces."""
        span_attribute_limit = int(os.getenv("PHOENIX_SPAN_ATTRIBUTE_LIMIT", "10"))
        
        # Essential attributes to preserve
        essential_attributes = [
            "agent_type", "user_query", "tool_name", "llm.model_name",
            "http.method", "http.url", "a2a.agent_name", "langgraph.node",
            "langgraph.step", "error.type"
        ]
        
        # Add essential attributes if available in context
        current_attributes = dict(span.attributes) if hasattr(span, 'attributes') else {}
        filtered_attributes = {}
        
        for key in essential_attributes[:span_attribute_limit]:
            if key in current_attributes:
                filtered_attributes[key] = current_attributes[key]
        
        # Update span with filtered attributes
        for key, value in filtered_attributes.items():
            span.set_attribute(key, value)


class PhoenixConfig:
    """Phoenix distributed tracing configuration for AI Platform Engineering."""
    
    def __init__(self):
        self.endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "http://localhost:4317")
        self.service_name = "ai-platform-engineer"
        self.service_version = "0.1.0"
        self.environment = os.getenv("DEPLOYMENT_ENVIRONMENT", "development")
        self.enabled = os.getenv("PHOENIX_TRACING_ENABLED", "true").lower() == "true"
        
    def setup_tracing(self) -> Optional[TracerProvider]:
        """Setup Phoenix distributed tracing with clean span processing."""
        if not self.enabled:
            logger.info("Phoenix tracing is disabled")
            return None
            
        try:
            # Create resource with service information
            resource = Resource.create({
                "service.name": self.service_name,
                "service.version": self.service_version,
                "deployment.environment": self.environment,
                "agent.type": "supervisor"
            })
            
            # Create tracer provider
            tracer_provider = TracerProvider(resource=resource)
            
            # Configure OTLP exporter
            otlp_exporter = OTLPSpanExporter(
                endpoint=self.endpoint,
                insecure=True  # Use insecure connection for local development
            )
            
            # Create batch span processor with clean filtering
            batch_processor = BatchSpanProcessor(
                otlp_exporter,
                max_queue_size=512,
                schedule_delay_millis=2000,  # Batch spans for efficiency
                export_timeout_millis=30000,
                max_export_batch_size=128
            )
            
            # Wrap with clean span processor
            clean_processor = CleanSpanProcessor(batch_processor)
            tracer_provider.add_span_processor(clean_processor)
            
            # Set global tracer provider
            trace.set_tracer_provider(tracer_provider)
            
            # Setup automatic instrumentation
            self._setup_auto_instrumentation()
            
            logger.info(f"Phoenix tracing initialized successfully. Endpoint: {self.endpoint}")
            return tracer_provider
            
        except Exception as e:
            logger.error(f"Failed to initialize Phoenix tracing: {e}")
            return None
    
    def _setup_auto_instrumentation(self) -> None:
        """Setup automatic instrumentation for common libraries."""
        try:
            # Instrument HTTP requests (for A2A calls)
            RequestsInstrumentor().instrument()
            HTTPXInstrumentor().instrument()
            
            # Instrument FastAPI (for main agent endpoints)
            FastAPIInstrumentor().instrument()
            
            logger.info("Automatic instrumentation setup completed")
            
        except Exception as e:
            logger.warning(f"Some instrumentations failed to setup: {e}")
    
    def get_tracer(self, name: str = "ai-platform-engineer"):
        """Get a tracer instance for manual tracing."""
        return trace.get_tracer(name, version=self.service_version)
    
    def create_user_span(self, name: str, user_query: str = None):
        """Create a span for user-initiated requests with proper attributes."""
        tracer = self.get_tracer()
        span = tracer.start_span(name)
        
        # Add essential attributes for clean visualization
        span.set_attribute("span.kind", "user_request")
        if user_query:
            span.set_attribute("user_query", user_query[:200])  # Limit query length
            
        return span
    
    def create_agent_span(self, agent_name: str, operation: str):
        """Create a span for agent operations."""
        tracer = self.get_tracer()
        span_name = f"a2a_{agent_name}_{operation}"
        span = tracer.start_span(span_name)
        
        span.set_attribute("agent_type", agent_name)
        span.set_attribute("operation", operation)
        span.set_attribute("span.kind", "agent_call")
        
        return span


# Global phoenix configuration instance
phoenix_config = PhoenixConfig()


def initialize_phoenix() -> None:
    """Initialize Phoenix tracing for the application."""
    phoenix_config.setup_tracing()


def get_tracer(name: str = "ai-platform-engineer"):
    """Get a tracer instance."""
    return phoenix_config.get_tracer(name)


def create_user_span(name: str, user_query: str = None):
    """Create a user request span."""
    return phoenix_config.create_user_span(name, user_query)


def create_agent_span(agent_name: str, operation: str):
    """Create an agent operation span."""
    return phoenix_config.create_agent_span(agent_name, operation)