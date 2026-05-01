"""Gunicorn configuration for Dynamic Agents service.

Uses UvicornWorker for async support. Worker recycling via max_requests
ensures periodic memory reclamation (Python does not return freed heap
to the OS — restarting the worker process is the only reliable way).
"""

import os

# Bind
bind = f"0.0.0.0:{os.getenv('PORT', '8001')}"

# Workers — default 1 (async handles concurrency within the event loop)
workers = int(os.getenv("WEB_WORKERS", "1"))
worker_class = "uvicorn.workers.UvicornWorker"

# Worker recycling — restart worker after N requests to reclaim memory.
# Jitter prevents all workers restarting simultaneously.
max_requests = int(os.getenv("MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("MAX_REQUESTS_JITTER", "100"))

# Timeouts — generous for long SSE streams
graceful_timeout = int(os.getenv("GRACEFUL_TIMEOUT", "120"))
timeout = int(os.getenv("WORKER_TIMEOUT", "120"))
keepalive = 5

# Logging — let our app logger handle formatting
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")
