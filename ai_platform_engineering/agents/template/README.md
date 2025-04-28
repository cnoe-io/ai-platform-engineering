# Agent Template

## Overview

You are a weekend activity planner agent. This agent helps users plan their weekend activities by leveraging specialized sub-agents.

### Sub-Agents

- **Hiking Agent**: For hiking-related queries, use `hiking_agent`.
- **Weather Agent**: For weather-related queries, use `weather_agent`.

## Usage

This project uses a `Makefile` to manage common tasks. Below are the available `make` targets:

### Makefile Targets

- `make run`: Start the weekend activity planner agent.
- `make test`: Run tests for the agent and its sub-agents.
- `make clean`: Clean up temporary files and build artifacts.

## Getting Started

1. Clone the repository:
  ```bash
  git clone <repository-url>
  cd agent-template
  ```

2. Run the agent:
  ```bash
  make run
  ```

3. Test the agent:
  ```bash
  make test
  ```

4. Clean up:
  ```bash
  make clean
  ```

## License

This project is licensed under the terms of the Apache License 2.0.