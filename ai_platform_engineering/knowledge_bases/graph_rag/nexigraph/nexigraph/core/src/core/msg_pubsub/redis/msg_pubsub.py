import os
import redis.asyncio as redis_async

from core import utils
from core.msg_pubsub.base import MessagePubSub

logging = utils.get_logger("redis_pubsub")

# This is a quick and dirty pubsub implementation using redis
# TODO: Move to NATS+Jetstream/Kafka or similar message broker with persistence
class RedisPubSub(MessagePubSub):
    def __init__(self):
        logging.debug("Initializing Redis PubSub")
        host = os.getenv("REDIS_HOST", "localhost")
        self.redis = redis_async.Redis(host=host, port=6379)

    async def publish(self, queue: str, msg: str):
        logging.debug(f"Publishing message {msg} to queue {queue}")
        if msg == "":
            logging.warning("Message is empty, skipping publish")
            return
        # Check if entity is already in the queue
        if not await self.redis.sismember(f"queue_set:{queue}", msg): # type: ignore
            logging.debug(f"Message {msg} not in queue {queue}, adding to queue")
            await self.redis.lpush(f"queue:{queue}", msg) # type: ignore
            await self.redis.sadd(f"queue_set:{queue}", msg) # type: ignore
        else:
            logging.info(f"Message {msg} already in queue {queue}, skipping publish")


    async def subscribe(self, queue: str) -> (str|None):
        # Pop the entity from the queue
        _, msg = await self.redis.brpop([f"queue:{queue}"]) # type: ignore # Blocking, returns a list - we only need the 1st item since we are using a single queue
        msg = msg.decode("utf-8")
        logging.debug(f"Received message(s) from queue {queue}")
        logging.debug(f"Removing message {msg} from queue set {queue}")
        await self.redis.srem(f"queue_set:{queue}",msg) # type: ignore
        return msg
