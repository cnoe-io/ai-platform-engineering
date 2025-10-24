
from server.restapi import app
import uvicorn
import os
import logging

if __name__ == "__main__":
    # Configure uvicorn access log to DEBUG level for health checks
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.setLevel(logging.DEBUG)
    
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=9446, 
        log_level=os.getenv("LOG_LEVEL", "debug").lower(),
        access_log=True
    )