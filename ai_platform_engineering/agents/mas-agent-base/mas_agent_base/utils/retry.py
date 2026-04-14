"""Exponential backoff retry mechanism for handling throttling errors."""

import asyncio
import inspect
import logging
import random
import time
from collections import deque
from functools import wraps
from typing import Any, Callable, Optional, Type

logger = logging.getLogger(__name__)


# Define exception types
class ThrottlingException(Exception):
    """Raised when a service is throttled."""

    pass


class ExponentialBackoffRetry:
    """Implements exponential backoff with jitter for retrying failed operations."""

    def __init__(
        self,
        max_retries: int = 4,
        base_delay: float = 2.0,  # AWS recommends starting at 2s
        max_delay: float = 30.0,
        exponential_base: float = 2.0,
        jitter: bool = True,
        exceptions_to_retry: Optional[tuple[Type[Exception], ...]] = None,
        history_limit: int = 100,
    ):
        """Initialize exponential backoff retry handler.

        Args:
            max_retries: Maximum number of retry attempts
            base_delay: Initial delay in seconds (AWS recommends 2.0)
            max_delay: Maximum delay in seconds
            exponential_base: Base for exponential backoff calculation
            jitter: Whether to add jitter to delays (recommended)
            exceptions_to_retry: Tuple of exception types to retry on
            history_limit: Maximum number of retry attempts to keep in history
        """
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
        self.retry_history = deque(maxlen=history_limit)
        self.exceptions_to_retry = exceptions_to_retry or (ThrottlingException,)

        logger.info(
            f"Initialized ExponentialBackoffRetry with max_retries={max_retries}, "
            f"base_delay={base_delay}s, max_delay={max_delay}s"
        )

    def calculate_delay(self, attempt: int) -> float:
        """Calculate delay with exponential backoff and optional jitter.

        Args:
            attempt: Current attempt number (0-indexed)

        Returns:
            Delay in seconds
        """
        # Calculate exponential delay
        delay = min(self.base_delay * (self.exponential_base**attempt), self.max_delay)

        if self.jitter:
            # Full jitter strategy (AWS recommended)
            # This spreads out retry attempts to avoid thundering herd
            delay = random.uniform(0, delay)

        return delay

    def should_retry(self, exception: Exception) -> bool:
        """Check if the exception should trigger a retry.

        Args:
            exception: The exception that was raised

        Returns:
            True if should retry, False otherwise
        """
        # Check if it's a throttling exception or AWS Bedrock throttling
        if isinstance(exception, self.exceptions_to_retry):
            return True

        # Check for specific error messages that indicate throttling
        error_msg = str(exception).lower()
        throttling_indicators = [
            "throttling",
            "too many requests",
            "rate limit",
            "too many tokens",
            "quota exceeded",
            "throttlingexception",
            "bedrock throttling",
        ]

        return any(indicator in error_msg for indicator in throttling_indicators)

    async def execute_with_retry(self, func: Callable, *args, **kwargs) -> Any:
        """Execute a function with exponential backoff retry.

        Args:
            func: The async function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function

        Returns:
            The result of the function call

        Raises:
            The last exception if all retries are exhausted
        """
        last_exception = None
        total_delay = 0

        for attempt in range(self.max_retries):
            try:
                # Execute the function
                result = func(*args, **kwargs)

                # Await if the result is awaitable (handles coroutines, tasks, futures)
                if inspect.isawaitable(result):
                    return await result
                else:
                    return result

            except Exception as e:
                last_exception = e

                # Check if we should retry this exception
                if not self.should_retry(e):
                    logger.error(f"Non-retryable exception: {e}")
                    raise

                # Record the retry attempt
                self.retry_history.append({"timestamp": time.time(), "attempt": attempt + 1, "error": str(e)})

                if attempt < self.max_retries - 1:
                    # Calculate delay for this attempt
                    delay = self.calculate_delay(attempt)
                    total_delay += delay

                    logger.warning(
                        f"Throttling on attempt {attempt + 1}/{self.max_retries}. "
                        f"Waiting {delay:.2f}s before retry (total delay: {total_delay:.2f}s). "
                        f"Error: {e}"
                    )

                    # Wait before retrying
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        f"All {self.max_retries} attempts exhausted after {total_delay:.2f}s total delay. "
                        f"Last error: {e}"
                    )

        # All retries exhausted
        raise last_exception

    def get_retry_stats(self) -> dict:
        """Get statistics about retry attempts.

        Returns:
            Dictionary with retry statistics
        """
        if not self.retry_history:
            return {"total_retries": 0, "last_retry": None}

        return {
            "total_retries": len(self.retry_history),
            "last_retry": self.retry_history[-1] if self.retry_history else None,
            "retry_history": list(self.retry_history)[-10:],  # Last 10 retries
        }

    def reset_history(self):
        """Reset the retry history."""
        self.retry_history = []


# Decorator for easy application
def with_exponential_backoff(
    max_retries: int = 4,
    base_delay: float = 2.0,
    max_delay: float = 30.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
    exceptions: Optional[tuple[Type[Exception], ...]] = None,
):
    """Decorator to add exponential backoff retry to async functions.

    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Initial delay in seconds
        max_delay: Maximum delay in seconds
        exponential_base: Base for exponential backoff
        jitter: Whether to add jitter to delays
        exceptions: Tuple of exception types to retry on

    Returns:
        Decorated function with retry logic
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            retry_handler = ExponentialBackoffRetry(
                max_retries=max_retries,
                base_delay=base_delay,
                max_delay=max_delay,
                exponential_base=exponential_base,
                jitter=jitter,
                exceptions_to_retry=exceptions,
            )
            return await retry_handler.execute_with_retry(func, *args, **kwargs)

        return wrapper

    return decorator


class GlobalRetryManager:
    """Global retry manager to track and coordinate retries across the system.

    This class provides centralized tracking of retry attempts across multiple
    services and contexts. It maintains statistics about throttling events,
    success/failure rates, and cumulative delays.

    Usage (via dependency injection):
        # In application entry point:
        retry_manager = GlobalRetryManager()

        # Pass to components that need retry tracking:
        my_service = MyService(retry_manager=retry_manager)

        # Track retry attempts:
        retry_manager.register_retry("bedrock", "query_123")
        # ... perform retry logic ...
        retry_manager.complete_retry("bedrock", "query_123", success=True)

    Note: This class is NOT instantiated as a global singleton.
    Users should create an instance at their application entry point
    and pass it to components via dependency injection for better
    testability and flexibility.
    """

    def __init__(self):
        """Initialize the global retry manager."""
        self.active_retries = {}
        self.global_stats = {
            "total_throttling_events": 0,
            "successful_retries": 0,
            "failed_retries": 0,
            "total_delay_seconds": 0,
        }

    def register_retry(self, service: str, context: str):
        """Register a retry attempt for tracking.

        Args:
            service: Name of the service being retried
            context: Context or identifier for the retry
        """
        key = f"{service}:{context}"
        if key not in self.active_retries:
            self.active_retries[key] = {"start_time": time.time(), "attempts": 0}
        self.active_retries[key]["attempts"] += 1
        self.global_stats["total_throttling_events"] += 1

        logger.info(f"Registered retry for {key}, attempt #{self.active_retries[key]['attempts']}")

    def complete_retry(self, service: str, context: str, success: bool):
        """Mark a retry sequence as complete.

        Args:
            service: Name of the service
            context: Context or identifier
            success: Whether the retry was ultimately successful
        """
        key = f"{service}:{context}"
        if key in self.active_retries:
            duration = time.time() - self.active_retries[key]["start_time"]
            self.global_stats["total_delay_seconds"] += duration

            if success:
                self.global_stats["successful_retries"] += 1
            else:
                self.global_stats["failed_retries"] += 1

            logger.info(f"Completed retry for {key}: success={success}, duration={duration:.2f}s")
            del self.active_retries[key]

    def get_global_stats(self) -> dict:
        """Get global retry statistics.

        Returns:
            Dictionary with global statistics
        """
        return {
            **self.global_stats,
            "active_retries": len(self.active_retries),
            "success_rate": (
                self.global_stats["successful_retries"]
                / max(
                    1,
                    self.global_stats["successful_retries"] + self.global_stats["failed_retries"],
                )
            )
            * 100,
        }


class BedrockRetryPolicy(ExponentialBackoffRetry):
    """AWS Bedrock-specific retry policy with recommended settings."""

    def __init__(self, **kwargs):
        """Initialize with AWS-recommended settings for Bedrock.

        AWS recommends:
        - Base delay of 2 seconds
        - Exponential base of 2
        - Full jitter to avoid thundering herd
        - Max delay of 30 seconds
        """
        defaults = {
            "max_retries": 4,
            "base_delay": 2.0,  # AWS recommended starting delay
            "max_delay": 30.0,
            "exponential_base": 2.0,
            "jitter": True,  # AWS recommends full jitter
            "exceptions_to_retry": (
                ThrottlingException,
                # Add common AWS/Bedrock exceptions here if available
            ),
        }
        defaults.update(kwargs)
        super().__init__(**defaults)

    def should_retry(self, exception: Exception) -> bool:
        """Check if exception is Bedrock throttling-related.

        Args:
            exception: The exception that was raised

        Returns:
            True if should retry, False otherwise
        """
        # First check parent class logic
        if super().should_retry(exception):
            return True

        # Check for Bedrock-specific error messages
        error_msg = str(exception).lower()
        bedrock_indicators = [
            "throttlingexception",
            "too many tokens",
            "quota exceeded",
            "bedrock throttling",
            "rate exceeded",
            "modelstreamererrorexception",
            "modelnotreadyexception",
            "servicequotaexceededexception",
        ]

        return any(indicator in error_msg for indicator in bedrock_indicators)
