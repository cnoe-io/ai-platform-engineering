
from server.restapi import app
import uvicorn
import os

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9446, log_level=os.getenv("LOG_LEVEL", "debug").lower())