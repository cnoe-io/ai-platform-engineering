from abc import ABC, abstractmethod

class MessagePubSub(ABC):
    """
    Abstract base class for message pub/sub implementations.
    The pubsub queue must only have unique messages.
    The pubsub must block on subscribe until a message is available.
    """

    @abstractmethod
    async def publish(self, queue: str, msg: str):
        """
        Send a message to the queue.
        :param queue: name of the queue/topic
        :param msg: the message to send
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def subscribe(self, queue: str) -> str:
        """
        Receive msg from a queue.
        """
        raise NotImplementedError("Subclasses must implement this method.")