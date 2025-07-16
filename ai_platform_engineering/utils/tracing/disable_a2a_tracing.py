# disable_a2a_tracing.py

import types
import sys
import logging

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
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

    logging.debug("A2A tracing disabled via monkey patching in main.py")

except Exception as e:
    logging.debug(f"A2A tracing monkey patch failed in main.py: {e}")

# =====================================================
# Now safe to import a2a modules
# =====================================================