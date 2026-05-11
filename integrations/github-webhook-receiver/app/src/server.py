import logging
import sys
import requests
import os
import json

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

def make_boto3_session():
    profile_name = os.getenv("AWS_PROFILE")
    if profile_name:
        return boto3.session.Session(profile_name=profile_name)
    return boto3.session.Session()


sqs = make_boto3_session().resource('sqs')

JENKINS_WEBHOOK_URL = os.getenv(
    "JENKINS_WEBHOOK_URL",
    "https://jenkins.example.com/github-webhook/",
)
SQS_QUEUE_NAME = os.getenv("SQS_QUEUE_NAME", "github-webhook-sqs")

def receive_messages(queue, max_number, wait_time):
    """
    Receive a batch of messages in a single request from an SQS queue.

    :param queue: The queue from which to receive messages.
    :param max_number: The maximum number of messages to receive. The actual number
                       of messages received might be less.
    :param wait_time: The maximum time to wait (in seconds) before returning. When
                      this number is greater than zero, long polling is used. This
                      can result in reduced costs and fewer false empty responses.
    :return: The list of Message objects received. These each contain the body
             of the message and metadata and custom attributes.
    """
    try:
        messages = queue.receive_messages(
            MessageAttributeNames=['All'],
            MaxNumberOfMessages=max_number,
            WaitTimeSeconds=wait_time
        )
        for msg in messages:
            logger.info("Received message: %s: %s", msg.message_id, msg.body)
    except ClientError as error:
        logger.exception("Couldn't receive messages from queue: %s", queue)
        raise error
    else:
        return messages


def delete_messages(queue, messages):
    """
    Delete a batch of messages from a queue in a single request.

    :param queue: The queue from which to delete the messages.
    :param messages: The list of messages to delete.
    :return: The response from SQS that contains the list of successful and failed
             message deletions.
    """
    try:
        entries = [{
            'Id': str(ind),
            'ReceiptHandle': msg.receipt_handle
        } for ind, msg in enumerate(messages)]
        response = queue.delete_messages(Entries=entries)
        if 'Successful' in response:
            for msg_meta in response['Successful']:
                logger.info("Deleted %s", messages[int(msg_meta['Id'])].receipt_handle)
        if 'Failed' in response:
            for msg_meta in response['Failed']:
                logger.warning(
                    "Could not delete %s",
                    messages[int(msg_meta['Id'])].receipt_handle
                )
    except ClientError:
        logger.exception("Couldn't delete messages from queue %s", queue)
    else:
        return response

def get_queue(name):
    """
    Gets an SQS queue by name.

    :param name: The name that was used to create the queue.
    :return: A Queue object.
    """
    try:
        queue = sqs.get_queue_by_name(QueueName=name)
        logger.info("Got queue '%s' with URL=%s", name, queue.url)
    except ClientError as error:
        logger.exception("Couldn't get queue named %s.", name)
        raise error
    else:
        return queue

def assumed_role_session(role_arn, token_file_location):
  web_identity_token = None
  with open(os.getenv("AWS_WEB_IDENTITY_TOKEN_FILE"), 'r') as content_file:
    web_identity_token = content_file.read()
    role = boto3.client('sts').assume_role_with_web_identity(RoleArn=role_arn,
                                                             RoleSessionName='assume-role',
                                                             WebIdentityToken=web_identity_token)
    credentials = role['Credentials']
    aws_access_key_id = credentials['AccessKeyId']
    aws_secret_access_key = credentials['SecretAccessKey']
    aws_session_token = credentials['SessionToken']

  return boto3.session.Session(aws_access_key_id=aws_access_key_id,
                               aws_secret_access_key=aws_secret_access_key,
                               aws_session_token=aws_session_token)

def main():
    queue = get_queue(SQS_QUEUE_NAME)

    batch_size = 1
    print(f"Receiving, handling, and deleting messages in batches of {batch_size}.")
    more_messages = True
    while more_messages:
        received_messages = receive_messages(queue, batch_size, 2)
        sys.stdout.flush()
        for message in received_messages:
            github_event = json.loads(message.body)
            github_event_name = github_event['headers']['x-github-event']
            # assisted-by Codex Codex-sonnet-4-6
            github_event_payload_raw = github_event['payload']
            github_event_payload = json.loads(github_event_payload_raw)
            print("*"*80)
            print(f"---EVENT: {github_event_name}---")
            print("---HEADERS---")
            headers = { "Content-Type": "application/json",
                        "X-GitHub-Event": github_event_name,
                        "X-GitHub-Delivery": github_event['headers'].get('x-github-delivery', ''),
                        "X-Hub-Signature-256": github_event['headers'].get('x-hub-signature-256', '')}
            print(json.dumps(headers, indent=2))
            jenkins_resp = requests.post(url=JENKINS_WEBHOOK_URL,
                                         headers=headers,
                                         data=github_event_payload_raw.encode('utf-8'))
            print("---PAYLOAD---")
            print(json.dumps(github_event_payload, indent=2))
            print("---JENKINS RESPONSE---")
            print(jenkins_resp)
            print("*"*80)
        if received_messages:
            delete_messages(queue, received_messages)
            print
            print('Waiting for more messages...', end='')
            print


if __name__ == '__main__':
    main()