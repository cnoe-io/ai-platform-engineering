"""Entry point: `caipe-scheduler` console script."""

from __future__ import annotations

import logging
import os

import uvicorn


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    uvicorn.run(
        "caipe_scheduler.app:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8080")),
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
