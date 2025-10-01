import asyncio
import traceback
from typing import Coroutine, Any, Tuple, Callable
import logging

logger = logging.getLogger(__name__)

class TaskScheduler:
    """A simple concurrent task scheduler using asyncio."""

    def __init__(self, max_parallel_tasks: int = 5):
        """
        Initializes the scheduler.

        :param max_parallel_tasks: The maximum number of tasks to run in parallel.
        """
        self._semaphore = asyncio.Semaphore(max_parallel_tasks)

    async def _worker(self, coro: Coroutine):
        """Worker that runs the coroutine and releases the semaphore."""
        async with self._semaphore:
            try:
                await coro
            except Exception as e:
                logger.error(traceback.format_exc())
                logger.error(f"Task failed with an exception: {e}", exc_info=True)

    async def run(self, coroutines: list[Coroutine]):
        """
        Runs a list of coroutines concurrently, respecting the max concurrency limit.

        :param coroutines: A list of coroutines to run.
        """
        tasks = [self._worker(coro) for coro in coroutines]
        await asyncio.gather(*tasks)