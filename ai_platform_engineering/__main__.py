import click
import uvicorn
import os
import logging

logging.basicConfig(level=logging.INFO)


@click.group()
@click.option('--host', default='0.0.0.0', help='Host to bind the server.')
@click.option('--port', default=None, type=int, help='Port to bind the server.')
@click.pass_context
def main(ctx, host, port):
  """Main entry point for MAS system selection."""
  print("Welcome to the AI Platform Engineering System!")
  ctx.ensure_object(dict)
  ctx.obj['host'] = host
  ctx.obj['port'] = port

@main.command()
@click.pass_context
def platform_engineer(ctx):
  """Start the AI Platform Engineer system."""
  host = ctx.obj.get('host', '0.0.0.0')
  port = ctx.obj.get('port', None)
  click.echo("Starting AI Platform Engineer system...")
  agent_protocol = os.getenv("AGENT_PROTOCOL", "a2a")
  logging.info(f"Selected agent protocol: {agent_protocol}")
  if agent_protocol == "fastapi":
    logging.info(f"Starting FastAPI server on {host}:{port or 5001}")
    uvicorn.run(
      "ai_platform_engineering.mas.platform_engineer.protocol_bindings.fastapi.main:app",
      host=host,
      port=port or 5001,
      reload=True)
  elif agent_protocol == "a2a":
    logging.info(f"Starting A2A server on {host}:{port or 8000}")
    uvicorn.run(
      "ai_platform_engineering.mas.platform_engineer.protocol_bindings.a2a.main:server.build",
      host=host,
      port=port or 8000,
      reload=True,
      factory=True)
  else:
    logging.error(f"Unsupported agent protocol: {agent_protocol}. Please set AGENT_PROTOCOL to 'fastapi' or 'a2a'.")
    click.echo(f"Unsupported agent protocol: {agent_protocol}. Please set AGENT_PROTOCOL to 'fastapi' or 'a2a'.")

@main.command()
@click.pass_context
def incident_management(ctx):
  """Start the Incident Management system."""
  click.echo("Starting Incident Management system...")

@main.command()
@click.pass_context
def product_owner(ctx):
  """Start the Product Owner system."""
  click.echo("Starting Product Owner system...")

if __name__ == "__main__":
  main()
