import click
import uvicorn
import os
from ai_platform_engineering.mas.platform_engineer.protocol_bindings.a2a.main import (
  server
)

@click.group()
def main():
  """Main entry point for MAS system selection."""
  print("Welcome to the AI Platform Engineering System!")
  pass


@main.command()
def platform_engineer():
  """Start the AI Platform Engineer system."""
  click.echo("Starting AI Platform Engineer system...")
  agent_protocol = os.getenv("AGENT_PROTOCOL", "a2a")
  if agent_protocol == "fastapi":
    uvicorn.run(
    "ai_platform_engineering.mas.platform_engineer.protocol_bindings.fastapi.main:app",
    host="0.0.0.0",
    port=5001,
    reload=True)

  elif agent_protocol == "a2a":
    uvicorn.run(
    "ai_platform_engineering.mas.platform_engineer.protocol_bindings.a2a.main:server.build",
    host="0.0.0.0",
    port=8000,
    reload=True,
    factory=True)
  else:
    click.echo(f"Unsupported agent protocol: {agent_protocol}. Please set AGENT_PROTOCOL to 'fastapi' or 'a2a'.")


@main.command()
def incident_management():
  """Start the Incident Management system."""
  click.echo("Starting Incident Management system...")


@main.command()
def product_owner():
  """Start the Product Owner system."""
  click.echo("Starting Product Owner system...")


if __name__ == "__main__":
  main()
