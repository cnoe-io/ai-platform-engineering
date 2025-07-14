import asyncio
import os
import dotenv

from agent import ForeignKeyRelationAgent


# Load environment variables from .env file
dotenv.load_dotenv()

SYNC_INTERVAL = int(os.getenv('SYNC_INTERVAL', 21600)) # 6 hours by default
ACCEPTANCE_THRESHOLD = float(os.getenv('ACCEPTANCE_THRESHOLD', float(0.75))) # > 75% by default
REJECTION_THRESHOLD = float(os.getenv('REJECTION_THRESHOLD', float(0.3))) # < 40% by default
MIN_COUNT_FOR_EVAL = int(os.getenv('MIN_COUNT_FOR_EVAL', int(3))) # 3 by default

asyncio.run(ForeignKeyRelationAgent(sync_interval=SYNC_INTERVAL,
    acceptance_threshold=ACCEPTANCE_THRESHOLD,
    rejection_threshold=REJECTION_THRESHOLD,
    min_count_for_eval=MIN_COUNT_FOR_EVAL).start())
