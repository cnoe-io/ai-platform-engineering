from enum import Enum
from typing import Optional
import redis.asyncio as redis
import redis.exceptions as redis_exceptions
from common.utils import get_logger
import datetime
from pydantic import BaseModel, Field
import asyncio

logger = get_logger(__name__)

class JobStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class JobInfo(BaseModel):
    job_id: str = Field(description="Job ID")
    status: JobStatus = Field(description="Job status")
    message: Optional[str] = Field(description="Current message")
    completed_counter: Optional[int] = Field(description="Completed counter")
    failed_counter: Optional[int] = Field(description="Failed counter")
    total: Optional[int] = Field(description="Total counter should be completed_counter + failed_counter")
    created_at: datetime.datetime = Field(description="Created at")
    completed_at: Optional[datetime.datetime] = Field(description="Completed at")
    error: Optional[str] = Field(description="Error message")

class JobManager:
    """Manages job status updates in Redis with locking to prevent race conditions."""

    def __init__(self, redis_client: redis.Redis):
        """
        Initializes the JobManager with a Redis client.

        :param redis_client: An asynchronous Redis client instance.
        """
        self.redis_client = redis_client
        self._job_key_prefix = "job_info"
        self._lock_key_prefix = "job_lock"

    def _get_job_key(self, job_id: str) -> str:
        """Constructs the Redis key for storing job information."""
        return f"{self._job_key_prefix}:{job_id}"

    def _get_lock_key(self, job_id: str) -> str:
        """Constructs the Redis key for the job's lock."""
        return f"{self._lock_key_prefix}:{job_id}"

    async def get_job(self, job_id: str) -> Optional[JobInfo]:
        """Retrieves a job's information from Redis."""
        job_data = await self.redis_client.get(self._get_job_key(job_id))
        if not job_data:
            return None
        return JobInfo.model_validate_json(job_data)

    async def update_job(
        self,
        job_id: str,
        *,
        status: Optional[JobStatus] = None,
        message: Optional[str] = None,
        completed_counter: Optional[int] = None,
        completed_increment: Optional[int] = None,
        failed_counter: Optional[int] = None,
        failed_increment: Optional[int] = None,
        total: Optional[int] = None,
        error: Optional[str] = None,
    ) -> bool:
        """
        Atomically updates a job's information in Redis.

        This method acquires a lock for the job ID, fetches the current job data,
        applies the updates, and writes the data back to Redis. The lock
        prevents concurrent modifications from corrupting the job state.

        :param job_id: The ID of the job to update.
        :param status: The new status of the job.
        :param message: The new message for the job.
        :param completed_counter: The counter for the job.
        :param completed_increment: The increment for the counter. If provided, the counter is incremented by this value.
        :param failed_counter: The counter for the job.
        :param failed_increment: The increment for the counter. If provided, the counter is incremented by this value.
        :param total: The total for the job.
        :param error: An error message if the job failed.
        :return: True if the update was successful, False otherwise.
        """
        lock_key = self._get_lock_key(job_id)
        job_key = self._get_job_key(job_id)

        # Construct a dictionary of updates from the provided arguments
        updates = {}
        if status is not None:
            updates["status"] = status
        if message is not None:
            updates["message"] = message
        if completed_counter is not None:
            updates["completed_counter"] = completed_counter
        if failed_counter is not None:
            updates["failed_counter"] = failed_counter
        if total is not None:
            updates["total"] = total
        if error is not None:
            updates["error"] = error

        if status is not None and (status == JobStatus.COMPLETED or status == JobStatus.FAILED):
            updates["completed_at"] = datetime.datetime.now()

        if not updates:
            logger.warning(f"update_job called for job {job_id} with no fields to update.")
            return True # No update was needed, but not an error state

        for attempt in range(10):
            try:
                # Acquire a lock with a timeout to prevent deadlocks
                async with self.redis_client.lock(lock_key, timeout=10, blocking_timeout=5):
                    job_data = await self.redis_client.get(job_key)
                    if not job_data:
                        logger.warning(f"Job {job_id} not found in Redis. Creating new job.")
                        job_info = JobInfo(
                            job_id=job_id,
                            status=JobStatus.PENDING,
                            created_at=datetime.datetime.now(datetime.timezone.utc),
                            completed_at=None,
                            error=None,
                            completed_counter=0,
                            failed_counter=0,
                            total=0,
                            message=""
                        )
                        await self.redis_client.set(job_key, job_info.model_dump_json())
                        return False

                    job_info = JobInfo.model_validate_json(job_data)
                    
                    # Apply the valid updates
                    updated_job_info = job_info.model_copy(update=updates)

                    # Apply the incrementors
                    if completed_increment is not None:
                        if updated_job_info.completed_counter is None:
                            updated_job_info.completed_counter = 0
                        updated_job_info.completed_counter += completed_increment
                    if failed_increment is not None:
                        if updated_job_info.failed_counter is None:
                            updated_job_info.failed_counter = 0
                        updated_job_info.failed_counter += failed_increment

                    # Write the updated data back to Redis
                    await self.redis_client.set(job_key, updated_job_info.model_dump_json())

                    logger.debug(f"Successfully updated job {job_id} with: {updates}")
                    return True

            except redis_exceptions.LockError:
                logger.warning(f"Could not acquire lock for job {job_id}. Retrying in 1 second... (Attempt {attempt + 1}/10)")
                await asyncio.sleep(1)

        logger.error(f"Failed to acquire lock for job {job_id} after 10 attempts. Update skipped.")
        return False