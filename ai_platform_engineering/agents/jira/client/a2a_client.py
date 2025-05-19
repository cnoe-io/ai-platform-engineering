from a2a.client import A2AClient
from typing import Any
from uuid import uuid4
from a2a.types import (
    SendMessageResponse,
    GetTaskResponse,
    SendMessageSuccessResponse,
    Task,
    TaskState,
    SendMessageRequest,
    MessageSendParams,
    GetTaskRequest,
    TaskQueryParams,
    SendStreamingMessageRequest,
)
import httpx
import traceback

AGENT_URL = 'http://localhost:10000'


def create_send_message_payload(
    text: str, task_id: str | None = None, context_id: str | None = None
) -> dict[str, Any]:
    """Helper function to create the payload for sending a task."""
    payload: dict[str, Any] = {
        'message': {
            'role': 'user',
            'parts': [{'type': 'text', 'text': text}],
            'messageId': uuid4().hex,
        },
    }

    if task_id:
        payload['message']['taskId'] = task_id

    if context_id:
        payload['message']['contextId'] = context_id
    return payload


def print_json_response(response: Any, description: str) -> None:
    """Helper function to print the JSON representation of a response."""
    print(f'--- {description} ---')
    if hasattr(response, 'root'):
        print(f'{response.root.model_dump_json(exclude_none=True)}\n')
    else:
        print(f'{response.model_dump(mode="json", exclude_none=True)}\n')


async def run_single_turn_test(client: A2AClient) -> None:
    """Runs a single-turn non-streaming test."""

    send_payload = create_send_message_payload(
        text='What is argocd version?',
    )
    request = SendMessageRequest(params=MessageSendParams(**send_payload))

    print('--- Single Turn Request ---')
    # Send Message
    send_response: SendMessageResponse = await client.send_message(request)
    print_json_response(send_response, 'Single Turn Request Response')
    if not isinstance(send_response.root, SendMessageSuccessResponse):
        print('received non-success response. Aborting get task ')
        return

    if not isinstance(send_response.root.result, Task):
        print('received non-task response. Aborting get task ')
        return

    task_id: str = send_response.root.result.id
    # print('---Query Task---')
    # # query the task
    # get_request = GetTaskRequest(params=TaskQueryParams(id=task_id))
    # get_response: GetTaskResponse = await client.get_task(get_request)
    # print_json_response(get_response, 'Query Task Response')


async def run_streaming_test(client: A2AClient) -> None:
  """Runs a single-turn streaming test."""

  send_payload = create_send_message_payload(
    text='ArgoCD version?',
  )

  request = SendStreamingMessageRequest(
    params=MessageSendParams(**send_payload)
  )

  print('--- Single Turn Streaming Request ---')
  stream_response = client.send_message_streaming(request)
  async for chunk in stream_response:
    print_json_response(chunk, 'Streaming Chunk')


async def run_multi_turn_test(client: A2AClient) -> None:
  """Runs a multi-turn test about ArgoCD applications in the jarvis-agent-dev project and their health status, streaming output like run_streaming_test."""
  print('--- Multi-Turn ArgoCD Application Health Status Request ---')

  # --- First Turn ---
  first_turn_payload = create_send_message_payload(
    text='List all ArgoCD applications in the jarvis-agent-dev project.'
  )
  request1 = SendStreamingMessageRequest(
    params=MessageSendParams(**first_turn_payload)
  )
  print('--- Multi-Turn: First Turn (Streaming) ---')
  stream_response1 = client.send_message_streaming(request1)
  context_id: str | None = None
  task_id: str | None = None
  async for chunk in stream_response1:
    print_json_response(chunk, 'Multi-Turn: First Turn Streaming Chunk')
    if hasattr(chunk, 'root') and isinstance(chunk.root, SendMessageSuccessResponse) and isinstance(chunk.root.result, Task):
      task: Task = chunk.root.result
      context_id = task.contextId
      task_id = task.id


async def main() -> None:
    """Main function to run the tests."""
    print(f'Connecting to agent at {AGENT_URL}...')
    try:
        async with httpx.AsyncClient() as httpx_client:
            client = await A2AClient.get_client_from_agent_card_url(
                httpx_client, AGENT_URL
            )
            print('Connection successful.')

            # await run_single_turn_test(client)
            print('\n' + '=' * 60)
            print('RUNNING STREAMING TEST')
            print('=' * 60 + '\n')
            await run_streaming_test(client)

            # print('\n' + '=' * 60)
            # print('RUNNING MULTI-TURN TEST')
            # print('=' * 60 + '\n')
            # await run_multi_turn_test(client)

    except Exception as e:
        traceback.print_exc()
        print(f'An error occurred: {e}')
        print('Ensure the agent server is running.')


if __name__ == '__main__':
    import asyncio

    asyncio.run(main())
