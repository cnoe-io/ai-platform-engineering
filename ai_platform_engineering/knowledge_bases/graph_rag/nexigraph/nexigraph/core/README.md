# NexiGraph Core

This package contains the core libraries and components for server and agents to run.

Main components:
  - `agent/`: Contains agentic components such as LLM tools that are shared across agents.
  - `graph_db/`: Abstract class (`base.py`) for a Graph database and an impelentation of the class.
  - `msg_pubsub/`: Abstract class (`base.py`) for a Message PubSub system and an implementation of the class.
  - `constant.py`: Constants shared across the system.
  - `models.py`: Pydantic models shared across the system.
  - `utils.py`: Helpful/utility functions 