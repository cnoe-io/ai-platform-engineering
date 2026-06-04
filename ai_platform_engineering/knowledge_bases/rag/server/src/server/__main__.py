import uvicorn
import os
import logging

# Dev-only: set DEV_HOT_RELOAD=true (with bind-mounted source) to auto-reload uvicorn on edits.
DEV_HOT_RELOAD = os.getenv("DEV_HOT_RELOAD", "false").lower() in ("1", "true", "yes")

if __name__ == "__main__":
  # Configure uvicorn access log to DEBUG level for health checks
  access_logger = logging.getLogger("uvicorn.access")
  access_logger.setLevel(logging.DEBUG)

  if DEV_HOT_RELOAD:
    # Reload mode requires the import-string form so the worker can reimport on change.
    uvicorn.run(
      "server.restapi:app",
      host="0.0.0.0",
      port=9446,
      log_level=os.getenv("LOG_LEVEL", "debug").lower(),
      access_log=True,
      reload=True,
      reload_dirs=["/app/server/src/server", "/app/common/src/common"],
    )
  else:
    from server.restapi import app
    uvicorn.run(
      app,
      host="0.0.0.0",
      port=9446,
      log_level=os.getenv("LOG_LEVEL", "debug").lower(),
      access_log=True,
    )
