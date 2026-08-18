"""Idempotent background publisher for the audit outbox."""

from __future__ import annotations

import asyncio
import logging

import httpx

from ai_platform_engineering.authz.audit.outbox import AuditOutbox

logger = logging.getLogger(__name__)


class AuditPublisher:
    def __init__(
        self,
        outbox: AuditOutbox,
        *,
        audit_service_url: str,
        batch_size: int = 100,
        interval_seconds: float = 1.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.outbox = outbox
        self.audit_service_url = audit_service_url.rstrip("/")
        self.batch_size = batch_size
        self.interval_seconds = interval_seconds
        self.client = client or httpx.AsyncClient(timeout=5.0)
        self._owns_client = client is None
        self._stop = asyncio.Event()

    async def publish_once(self) -> int:
        events = await self.outbox.batch(self.batch_size)
        if not events or not self.audit_service_url:
            return 0
        ids = [event.event_id for event in events]
        try:
            response = await self.client.post(
                f"{self.audit_service_url}/v1/audit/events",
                json={"events": [event.model_dump(mode="json") for event in events]},
                headers={"Idempotency-Key": ids[0]},
            )
            response.raise_for_status()
        except httpx.HTTPError:
            await self.outbox.mark_attempt(ids)
            logger.warning("authorization audit batch delivery failed")
            return 0
        await self.outbox.acknowledge(ids)
        return len(ids)

    async def run(self) -> None:
        backoff = self.interval_seconds
        while not self._stop.is_set():
            delivered = await self.publish_once()
            backoff = self.interval_seconds if delivered else min(backoff * 2, 30.0)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=backoff)
            except TimeoutError:
                continue

    async def stop(self) -> None:
        self._stop.set()
        if self._owns_client:
            await self.client.aclose()
