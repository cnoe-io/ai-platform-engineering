# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
A2A Noise Reduction for GitHub Agent

This module provides monkey patching to disable A2A framework's
built-in tracing decorators specifically for the GitHub agent container.

CRITICAL: This module must be imported and called BEFORE any A2A framework imports
to ensure proper monkey patching of the telemetry module.
"""

import sys
import types
import logging

logger = logging.getLogger(__name__)

def disable_a2a_tracing() -> bool:
    """
    Disable A2A framework tracing by monkey patching the telemetry module.
    
    This function replaces A2A's trace decorators with no-op implementations
    to prevent interference with custom Langfuse tracing in the GitHub agent.
    
    Returns:
        bool: True if successful, False if failed
        
    Note:
        This MUST be called before any A2A framework imports to be effective.
    """
    try:
        # Create no-op decorators to replace a2a's trace decorators
        def noop_trace_function(func=None, **_kwargs):
            """No-op replacement for trace_function decorator."""
            if func is None:
                return lambda f: f  # Return decorator that does nothing
            return func  # Return function unchanged
        
        def noop_trace_class(cls=None, **_kwargs):
            """No-op replacement for trace_class decorator."""
            if cls is None:
                return lambda c: c  # Return decorator that does nothing
            return cls  # Return class unchanged
        
        # Create a dummy SpanKind class with required attributes
        class DummySpanKind:
            """Dummy SpanKind class to replace OpenTelemetry SpanKind."""
            INTERNAL = 'INTERNAL'
            SERVER = 'SERVER'
            CLIENT = 'CLIENT'
            PRODUCER = 'PRODUCER'
            CONSUMER = 'CONSUMER'
        
        # Monkey patch the a2a telemetry module before it's imported anywhere
        telemetry_module = types.ModuleType('a2a.utils.telemetry')
        telemetry_module.trace_function = noop_trace_function
        telemetry_module.trace_class = noop_trace_class
        telemetry_module.SpanKind = DummySpanKind
        
        # Insert into sys.modules to intercept imports
        sys.modules['a2a.utils.telemetry'] = telemetry_module
        
        logger.debug("✅ GitHub Agent: A2A tracing disabled successfully via monkey patching")
        return True
        
    except Exception as e:
        logger.error(f"❌ GitHub Agent: A2A tracing monkey patch failed: {e}")
        return False