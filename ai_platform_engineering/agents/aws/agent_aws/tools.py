# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Custom tools for AWS Agent including AWS CLI execution."""

import asyncio
import logging
import os
import re
import shlex
from typing import Any, Optional

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# Dangerous commands that should be blocked by default
BLOCKED_COMMAND_PATTERNS = [
    r"--delete-bucket",
    r"delete-bucket",
    r"terminate-instances",
    r"delete-cluster",
    r"delete-stack",
    r"delete-db-instance",
    r"delete-table",
    r"delete-function",
    r"delete-role",
    r"delete-user",
    r"delete-policy",
    r"delete-secret",
    r"delete-key",
    r"rm\s+--recursive",
    r"s3\s+rm.*--recursive",
    r"delete-security-group",
    r"delete-vpc",
    r"delete-subnet",
    r"revoke-security-group",
]

# Maximum execution time for CLI commands
MAX_EXECUTION_TIME = int(os.getenv("AWS_CLI_MAX_EXECUTION_TIME", "120"))

# Maximum output size - keep small to avoid context overflow (128K token limit)
# 20KB is roughly ~5K tokens, safe for multiple tool calls
MAX_OUTPUT_SIZE = int(os.getenv("AWS_CLI_MAX_OUTPUT_SIZE", "20000"))

# AWS profiles configuration
_aws_profiles_configured = False


def setup_aws_profiles() -> list[dict]:
    """
    Setup AWS CLI profiles from AWS_ACCOUNT_LIST environment variable.

    Parses AWS_ACCOUNT_LIST (format: "name1:id1,name2:id2") and generates
    ~/.aws/config with profiles that use assume-role for cross-account access.

    Called at agent initialization - always regenerates to ensure fresh config.

    Returns:
        List of configured account dicts with 'name' and 'id' keys
    """
    global _aws_profiles_configured

    # Skip if already configured in this process
    if _aws_profiles_configured:
        logger.debug("AWS profiles already configured in this session")
        aws_account_list = os.getenv("AWS_ACCOUNT_LIST", "")
        accounts = []
        for entry in aws_account_list.split(","):
            entry = entry.strip()
            if not entry:
                continue
            if ":" in entry:
                name, account_id = entry.split(":", 1)
                accounts.append({"name": name.strip(), "id": account_id.strip()})
            else:
                accounts.append({"name": entry, "id": entry})
        return accounts

    aws_account_list = os.getenv("AWS_ACCOUNT_LIST", "")
    cross_account_role = os.getenv("CROSS_ACCOUNT_ROLE_NAME", "caipe-read-only")

    if not aws_account_list:
        logger.info("AWS_ACCOUNT_LIST not set, skipping profile setup")
        return []

    # Parse account list
    accounts = []
    for entry in aws_account_list.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if ":" in entry:
            name, account_id = entry.split(":", 1)
            accounts.append({"name": name.strip(), "id": account_id.strip()})
        else:
            accounts.append({"name": entry, "id": entry})

    if not accounts:
        logger.info("No accounts parsed from AWS_ACCOUNT_LIST")
        return []

    # Generate AWS config file
    aws_config_dir = os.path.expanduser("~/.aws")
    aws_config_file = os.path.join(aws_config_dir, "config")

    # Create .aws directory if needed
    os.makedirs(aws_config_dir, exist_ok=True)

    # Always regenerate profiles at startup to ensure fresh config
    # Use credential_source = Environment since credentials come from env vars
    profile_sections = ["# AUTO-GENERATED PROFILES FROM AWS_ACCOUNT_LIST"]
    profile_sections.append("# Regenerated at agent startup - do not edit manually\n")

    for acc in accounts:
        profile_section = f"""[profile {acc['name']}]
role_arn = arn:aws:iam::{acc['id']}:role/{cross_account_role}
credential_source = Environment
"""
        profile_sections.append(profile_section)

    # Write config file (overwrite to ensure fresh profiles)
    with open(aws_config_file, "w") as f:
        f.write("\n".join(profile_sections))

    logger.info(f"✅ Generated AWS profiles for {len(accounts)} accounts: {[a['name'] for a in accounts]}")
    _aws_profiles_configured = True

    return accounts


def get_configured_profiles() -> list[str]:
    """Get list of configured AWS profile names."""
    accounts = setup_aws_profiles()
    return [acc['name'] for acc in accounts]


# Auto-setup profiles when module is imported (at agent startup)
def _init_aws_profiles():
    """Initialize AWS profiles at module import time."""
    aws_account_list = os.getenv("AWS_ACCOUNT_LIST", "")
    if aws_account_list:
        setup_aws_profiles()


_init_aws_profiles()


class AWSCLIToolInput(BaseModel):
    """Input schema for AWS CLI tool."""

    command: str = Field(
        description=(
            "The AWS CLI command to execute. Should be a valid AWS CLI command "
            "without the 'aws' prefix. For example: 'ec2 describe-instances' or "
            "'s3 ls s3://my-bucket'. The command will be executed with appropriate "
            "AWS credentials from the environment."
        )
    )

    profile: str = Field(
        description=(
            "AWS profile name for the account to query. THIS IS REQUIRED! "
            "Available profiles: eticloud, outshift-common-dev, outshift-common-staging, outshift-common-prod, eti-ci, cisco-research, eticloud-demo. "
            "Use 'default' for the default AWS account (same as environment credentials). "
            "When user says 'in eticloud', use profile='eticloud'. "
            "When user says 'get all EC2', make separate calls with each profile."
        )
    )

    region: Optional[str] = Field(
        default=None,
        description=(
            "AWS region to use for the command. If not specified, uses the "
            "default region from AWS_REGION or AWS_DEFAULT_REGION environment variable."
        )
    )

    output_format: Optional[str] = Field(
        default="json",
        description=(
            "Output format for the AWS CLI command. Options: json, text, table, yaml. "
            "Default is 'json' for easier parsing."
        )
    )

    jq_filter: Optional[str] = Field(
        default=None,
        description=(
            "Optional jq filter to process JSON output. Use this to extract specific fields. "
            "Examples: '.Reservations[].Instances[] | {Name: .Tags[]? | select(.Key==\"Name\") | .Value, ID: .InstanceId, State: .State.Name}', "
            "'.clusters[]', '.DBInstances[] | {Name: .DBInstanceIdentifier, Status: .DBInstanceStatus}'. "
            "The filter is applied to the raw JSON output from AWS CLI."
        )
    )


class AWSCLITool(BaseTool):
    """
    Tool for executing AWS CLI commands (READ-ONLY).

    This tool provides secure read-only access to ALL AWS services via CLI:
    - Only read operations allowed (describe, list, get, lookup)
    - No create, update, delete, or modify operations
    - Service whitelist validation
    - Timeout protection
    - Output size limits

    Enable by setting USE_AWS_CLI_AS_TOOL=true in environment.
    """

    name: str = "aws_cli_execute"
    description: str = (
        "Execute AWS CLI read-only commands to query any AWS service. "
        "Supports ALL AWS services - use describe-*, list-*, get-* operations. "
        "The command should NOT include the 'aws' prefix - just the service and action. "
        "Examples: 'ec2 describe-instances', 's3 ls', 'iam list-roles'. "
        "Write operations (create, delete, update) are blocked. "
        "IMPORTANT: Use 'profile' parameter to query specific AWS accounts! "
        "When user asks about 'eticloud', set profile='eticloud'. "
        "When user asks 'get all EC2', query each profile separately."
    )
    args_schema: type[BaseModel] = AWSCLIToolInput

    # Configuration
    allow_write_operations: bool = False

    def __init__(self, allow_write_operations: bool = False, **kwargs: Any):
        """
        Initialize the AWS CLI tool.

        Args:
            allow_write_operations: If True, allows write/modify operations.
                                   If False (default), only read operations are allowed.
        """
        super().__init__(**kwargs)
        self.allow_write_operations = allow_write_operations

    def _validate_command(self, command: str) -> tuple[bool, str]:
        """
        Validate the AWS CLI command for security.

        Args:
            command: The AWS CLI command (without 'aws' prefix)

        Returns:
            Tuple of (is_valid, error_message)
        """
        # Normalize command
        command = command.strip()

        # Check for shell injection attempts
        # Note: { and } are allowed for JMESPath --query syntax
        dangerous_chars = [";", "|", "&", "`", "$", "<", ">", "\\"]
        for char in dangerous_chars:
            if char in command:
                return False, (
                    f"Command contains shell character '{char}' which is not allowed. "
                    f"Please rewrite the command without '{char}'. "
                    "Use --query for filtering instead of shell pipes."
                )

        # Extract service name (first word)
        parts = command.split()
        if not parts:
            return False, "Empty command provided"

        service = parts[0].lower()

        # Validate service is in allowed list
        # Check for blocked command patterns
        for pattern in BLOCKED_COMMAND_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                if not self.allow_write_operations:
                    return False, (
                        f"Command matches blocked pattern '{pattern}'. "
                        "Destructive operations are disabled. "
                        "Set AWS_CLI_ALLOW_WRITE=true to enable."
                    )

        # Check for write operations if not allowed
        if not self.allow_write_operations:
            write_indicators = [
                "create-", "delete-", "put-", "update-", "modify-",
                "attach-", "detach-", "associate-", "disassociate-",
                "start-", "stop-", "terminate-", "reboot-",
                "enable-", "disable-", "register-", "deregister-",
                "add-", "remove-", "copy-", "import-", "export-",
                "run-", "invoke-", "execute-", "send-"
            ]
            action = parts[1] if len(parts) > 1 else ""
            for indicator in write_indicators:
                if indicator in action.lower():
                    return False, (
                        f"Write operation '{action}' detected. "
                        "Only read operations are allowed by default. "
                        "Set AWS_CLI_ALLOW_WRITE=true to enable write operations."
                    )

        return True, ""

    def _run(
        self,
        command: str,
        region: Optional[str] = None,
        output_format: Optional[str] = "json",
        jq_filter: Optional[str] = None
    ) -> str:
        """
        Synchronous execution of AWS CLI command.

        Args:
            command: AWS CLI command (without 'aws' prefix)
            region: Optional AWS region override
            output_format: Output format (json, text, table, yaml)
            jq_filter: Optional jq filter for JSON processing

        Returns:
            Command output as string
        """
        return asyncio.run(self._arun(command, region, output_format, jq_filter))

    async def _arun(
        self,
        command: str,
        profile: str = "default",
        region: Optional[str] = None,
        output_format: Optional[str] = "json",
        jq_filter: Optional[str] = None
    ) -> str:
        """
        Asynchronous execution of AWS CLI command.

        Args:
            command: AWS CLI command (without 'aws' prefix)
            profile: AWS profile name (required). Use 'default' for default account.
            region: Optional AWS region override
            output_format: Output format (json, text, table, yaml)
            jq_filter: Optional jq filter for JSON processing

        Returns:
            Command output as string
        """
        # Validate the command
        is_valid, error_msg = self._validate_command(command)
        if not is_valid:
            logger.warning(f"AWS CLI command validation failed: {error_msg}")
            return f"❌ Command validation failed: {error_msg}"

        # Build the full command
        aws_region = region or os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-west-2"))

        # Force JSON output if jq_filter is specified
        if jq_filter:
            output_fmt = "json"
        else:
            output_fmt = output_format if output_format in ["json", "text", "table", "yaml"] else "json"

        # Build profile flag - skip for 'default' profile (uses environment credentials)
        profile_flag = f"--profile {profile}" if profile and profile.lower() != "default" else ""

        # Only add --region if not already in command
        if "--region" in command:
            full_command = f"aws {profile_flag} {command} --output {output_fmt}".strip()
        else:
            full_command = f"aws {profile_flag} {command} --region {aws_region} --output {output_fmt}".strip()

        # Clean up any double spaces
        full_command = " ".join(full_command.split())

        # Log which account is being queried
        logger.info(f"Querying account: {profile}")

        logger.info(f"Executing AWS CLI command: {full_command}")
        if jq_filter:
            logger.info(f"With jq filter: {jq_filter}")

        try:
            # Execute the command with timeout
            process = await asyncio.create_subprocess_shell(
                full_command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ}  # Pass through AWS credentials from environment
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=MAX_EXECUTION_TIME
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return f"❌ Command timed out after {MAX_EXECUTION_TIME} seconds"

            # Decode output
            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            # Check return code
            if process.returncode != 0:
                error_output = stderr_str or stdout_str
                logger.error(f"AWS CLI command failed: {error_output}")
                return f"❌ Command failed (exit code {process.returncode}):\n{error_output}"

            # Apply jq filter if specified
            if jq_filter and stdout_str:
                try:
                    import tempfile
                    import json

                    # Write output to temp file
                    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                        f.write(stdout_str)
                        temp_file = f.name

                    try:
                        # Run jq on the temp file
                        # Escape single quotes in the filter
                        safe_filter = jq_filter.replace("'", "'\"'\"'")
                        jq_command = f"jq '{safe_filter}' {temp_file}"

                        jq_process = await asyncio.create_subprocess_shell(
                            jq_command,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        )

                        jq_stdout, jq_stderr = await asyncio.wait_for(
                            jq_process.communicate(),
                            timeout=30  # 30 second timeout for jq
                        )

                        if jq_process.returncode == 0:
                            stdout_str = jq_stdout.decode("utf-8", errors="replace")
                            logger.info(f"jq filter applied successfully, output size: {len(stdout_str)}")
                        else:
                            jq_error = jq_stderr.decode("utf-8", errors="replace")
                            logger.warning(f"jq filter failed: {jq_error}")
                            # Return original output with warning
                            stdout_str = f"⚠️ jq filter failed ({jq_error}), showing raw output:\n\n{stdout_str}"
                    finally:
                        # Clean up temp file
                        import os as os_module
                        try:
                            os_module.unlink(temp_file)
                        except:
                            pass

                except Exception as e:
                    logger.warning(f"jq processing error: {e}")
                    stdout_str = f"⚠️ jq processing failed ({e}), showing raw output:\n\n{stdout_str}"

            # Truncate large outputs
            if len(stdout_str) > MAX_OUTPUT_SIZE:
                stdout_str = (
                    stdout_str[:MAX_OUTPUT_SIZE] +
                    f"\n\n... [Output truncated. Total size: {len(stdout_str)} chars]"
                )

            return stdout_str if stdout_str else "✅ Command completed successfully (no output)"

        except FileNotFoundError:
            return "❌ AWS CLI is not installed or not in PATH"
        except Exception as e:
            logger.error(f"AWS CLI execution error: {e}")
            return f"❌ Error executing command: {str(e)}"


def get_aws_cli_tool() -> Optional[AWSCLITool]:
    """
    Factory function to create AWS CLI tool if enabled.

    Returns:
        AWSCLITool instance if USE_AWS_CLI_AS_TOOL=true (default), None otherwise

    Note: Write operations are always disabled. Only read operations (describe, list, get) are allowed.
    """
    use_aws_cli = os.getenv("USE_AWS_CLI_AS_TOOL", "true").lower() == "true"

    if not use_aws_cli:
        logger.info("AWS CLI tool is disabled (USE_AWS_CLI_AS_TOOL=false)")
        return None

    # Setup AWS profiles for cross-account access
    accounts = setup_aws_profiles()
    if accounts:
        logger.info(f"AWS profiles configured: {[a['name'] for a in accounts]}")

    # Always read-only - no create, update, delete operations
    logger.info("AWS CLI tool enabled (read-only mode)")

    return AWSCLITool(allow_write_operations=False)


class ReflectionToolInput(BaseModel):
    """Input schema for reflection tool."""

    user_query: str = Field(
        description="The original user query (e.g., 'get all S3 buckets and their security posture')"
    )

    total_items: int = Field(
        description="Total number of items that should be processed (e.g., total buckets found)"
    )

    processed_items: int = Field(
        description="Number of items actually processed so far (e.g., buckets with security details gathered)"
    )


class ReflectionTool(BaseTool):
    """Tool for reflecting on whether all items have been processed."""

    name: str = "reflect_on_completion"
    description: str = (
        "Use this tool after gathering data to check if you've completed processing ALL items. "
        "Pass the original user query, total items found, and items processed. "
        "The tool will tell you if you need to continue processing more items."
    )
    args_schema: type[BaseModel] = ReflectionToolInput

    def _run(
        self,
        user_query: str,
        total_items: int,
        processed_items: int
    ) -> str:
        """Check if all items have been processed."""
        user_query_lower = user_query.lower()

        # Check if user asked for "all"
        asking_for_all = any(word in user_query_lower for word in ["all", "every", "each"])

        if not asking_for_all:
            return "✅ User didn't ask for 'all' - you can present results now."

        # User asked for "all" - check if we've processed everything
        if processed_items >= total_items:
            return f"✅ COMPLETE: Processed {processed_items}/{total_items} items. You can present the final results now."
        else:
            remaining = total_items - processed_items
            return (
                f"❌ INCOMPLETE: Only processed {processed_items}/{total_items} items. "
                f"You still need to process {remaining} more items. "
                f"DO NOT present results yet - continue processing the remaining items immediately."
            )

    async def _arun(
        self,
        user_query: str,
        total_items: int,
        processed_items: int
    ) -> str:
        """Async version."""
        return self._run(user_query, total_items, processed_items)


def get_reflection_tool() -> ReflectionTool:
    """Get the reflection tool instance."""
    return ReflectionTool()

