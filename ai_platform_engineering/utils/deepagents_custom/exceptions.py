"""Custom exceptions for the deep agent system."""


class AgentStopRequestedError(Exception):
    """Raised when an agent stop is requested.
    
    This exception is used to gracefully terminate agent execution
    when a stop condition is met (e.g., user cancellation, timeout).
    """
    pass


class ToolError(Exception):
    """Raised when a tool execution fails.
    
    This exception wraps tool-specific errors with additional context
    about which tool failed and why.
    
    Attributes:
        tool_name: Name of the tool that failed
        original_error: The original exception that was raised
    """
    
    def __init__(self, tool_name: str, message: str, original_error: Exception = None):
        self.tool_name = tool_name
        self.original_error = original_error
        super().__init__(f"Tool '{tool_name}' failed: {message}")
