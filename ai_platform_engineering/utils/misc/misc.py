import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Coroutine, TypeVar

__all__ = [
    "run_coroutine_sync",
]

T = TypeVar("T")


def run_coroutine_sync(coroutine: Coroutine[Any, Any, T], timeout: float = 30) -> T:
    """
    Runs a async function inside a sync function with timeout and event loop management.
    Source: https://stackoverflow.com/a/78911765
    Args:
        coroutine: The async function to run.
        timeout: The timeout for the async function.

    Returns:
        The result of the async function.
    """
    def run_in_new_loop():
        new_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(new_loop)
        try:
            # Always enforce timeout in the new loop
            return new_loop.run_until_complete(asyncio.wait_for(coroutine, timeout))
        finally:
            new_loop.close()

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop on this thread: run with timeout enforcement
        return asyncio.run(asyncio.wait_for(coroutine, timeout))

    if threading.current_thread() is threading.main_thread():
        if not loop.is_running():
            # Main thread with an event loop object that is not running: run with timeout
            return loop.run_until_complete(asyncio.wait_for(coroutine, timeout))
        else:
            with ThreadPoolExecutor() as pool:
                future = pool.submit(run_in_new_loop)
                return future.result(timeout=timeout)
    else:
        # Running inside a non-main thread that has a loop: wait with timeout
        return asyncio.run_coroutine_threadsafe(coroutine, loop).result(timeout=timeout)
