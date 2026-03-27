# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Pydantic models for CAIPE Slack Bot configuration.
"""

import os

from pydantic import BaseModel, Field, model_validator
from typing import Dict, Any, Optional, List


class GlobalDefaults(BaseModel):
    """Global defaults that apply to all channels"""

    time_frame: int = 19800
    max_messages: int = 3

    jira_server: str = Field(
        default_factory=lambda: os.environ.get("JIRA_BASE_URL", "")
    )

    # Prompt defaults — each can be overridden via SLACK_INTEGRATION_PROMPT_* env vars
    response_style_instruction: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_RESPONSE_STYLE",
            """Response Style: Keep your answers conversational and straightforward - like chatting with a colleague.
Be concise and get to the point (CRITICAL: MAXIMUM response length should be around 5 sentences UNLESS user
specifically asks for full response. After providing information, ALWAYS ask if they would like to know more
in a separate line.) without unnecessary details or overly formal explanations.
If citing sources, CRITICAL: ALWAYS include the source AND LINK(S)!""",
        )
    )

    default_qanda_prompt: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_QANDA",
            """You are helping answer questions. A user has posted a message in the channel.

STEP 1 - Check if this is an action request (no search needed):
If the message is ONLY asking for human action with no technical question, respond with "Standing by for the team!" and stop.
- Asking for code/MR/PR review with no technical question
- Asking for approvals on an MR/PR
- Asking a human to take an action (rerun pipeline, close ticket, etc.)
- Asking "who can help" or "can someone" do something

STEP 2 - Search for sources (MANDATORY - DO NOT SKIP):
You MUST execute search queries against the knowledge base before responding.
- Do NOT answer from general knowledge - internal documentation may differ from public information
- Do NOT assume you know the answer - always search first
- Try different keyword combinations and related concepts
- Aim for at least 5 search queries to ensure comprehensive coverage
If you respond without searching, your answer will likely be wrong.

STEP 3 - Respond based on what you found:
- Answer in ~5 sentences, conversational tone
- If you found nothing relevant, say so honestly and suggest where to ask
- Ask if they want more details

STEP 4 - List sources (REQUIRED):
End your response with a Sources section listing ALL sources you found during your search, with titles and links. Include sources even if only tangentially related.

User message:
{message_text}""",
        )
    )

    overthink_qanda_prompt: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_OVERTHINK_QANDA",
            """You are helping answer questions in a Slack channel. A user has posted a message.

STEP 1 - Quick filter (no search needed):
- Is this ONLY a code/MR/PR review request with no technical question? Respond with [DEFER] and stop
- Is this ONLY asking a human to take an action with no information question? Respond with [DEFER] and stop
- Otherwise, continue to Step 2

STEP 2 - Search for sources (MANDATORY - DO NOT SKIP):
You MUST execute search queries against the knowledge base before responding.
- Do NOT answer from general knowledge - internal documentation may differ from public information
- Do NOT assume you know the answer - always search first
- Try different keyword combinations and related concepts
- Aim for at least 5 search queries to ensure comprehensive coverage
- Use both keyword_search=true (for exact terms, parameter names, config values) AND semantic search (for concepts, how-to questions) — do not use only one mode
- If any result looks relevant, use fetch_document to get the full content — prioritize configuration/setup documents over error or troubleshooting documents
If you respond without searching, your answer will likely be wrong.

STEP 3 - Assess confidence based on what you found:
- Found 2+ sources that agree on the answer? HIGH confidence
- Found 1 source that DIRECTLY and COMPLETELY answers the question (not just mentions it)? HIGH confidence
- Found sources that mention the topic but don't contain the specific answer? LOW confidence
- Found only tangentially related info or nothing useful? LOW confidence

STEP 4 - Respond (DO NOT show your reasoning steps, only output the final response):
- If LOW confidence:
  - List any sources you found with titles and links (even if not directly relevant) for debugging purposes
  - Final line must be [LOW_CONFIDENCE]
- If HIGH confidence:
  - Answer in ~5 sentences, conversational tone
  - Reference sources inline when relevant
  - End with a Sources: section listing ALL sources you found with titles and links
  - Final line must be [CONFIDENCE: HIGH]

User message:
{message_text}""",
        )
    )

    default_mention_prompt: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_MENTION",
            """A user has @mentioned you in Slack.

STEP 1 - Determine intent:
- Action request (create ticket, run pipeline, etc.) - execute the action
- Question or research request - continue to Step 2

STEP 2 - Search for sources (MANDATORY for questions):
You MUST execute search queries against the knowledge base before answering any question.
- Do NOT answer from general knowledge - internal documentation may differ from public information
- Do NOT assume you know the answer - always search first
- Try different keyword combinations and related concepts
- Aim for at least 5 search queries to ensure comprehensive coverage
If you respond without searching, your answer will likely be wrong.

STEP 3 - Respond:
- For actions: execute and confirm what you did
- For questions: answer based on search results in ~5 sentences, conversational tone
- End with a Sources section listing ALL sources you found, with titles and links

User message:
{message_text}""",
        )
    )

    humble_followup_prompt: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_HUMBLE_FOLLOWUP",
            """You previously saw the user's message but did not respond automatically. The user is now following up by @mentioning you.

Start by briefly explaining why you did not respond earlier. There are two possible reasons based on your earlier analysis:
1. You recognized it as a request for human action (like MR reviews, approvals, or asking someone to do something) - explain you stepped back to let humans handle it
2. You researched but were not confident in what you found - explain you are not an expert on this topic

Then offer to help now:
- If it was a human action request, ask how you can assist (maybe they have a technical question, or want help with something else)
- If it was low confidence, share what you found from your research, be clear about gaps, and suggest where they might find better help

If you did any research, end with a Sources section listing ALL sources you found, with titles and links.

Be conversational and supportive, not overly apologetic.

User's follow-up message:
{message_text}""",
        )
    )

    overthink_ai_alerts_prompt: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_OVERTHINK_AI_ALERTS",
            """You are an automated alert classifier. Analyze this alert and decide whether to take action.

STEP 1 - Quick filter (no search needed):
- Is this a routine informational notification (oncall changes, deployments, status updates)? Respond with [DEFER] and stop
- Is this a test/development alert with no production impact? Respond with [DEFER] and stop
- Otherwise, continue to Step 2

STEP 2 - Search for context (MANDATORY - DO NOT SKIP):
Search for related incidents, runbooks, and existing tickets.
- Look for duplicate or related tickets that may already be tracking this issue
- Check if this is a known pattern or recurring alert
- Aim for at least 3 search queries

STEP 3 - Assess confidence:
- HIGH: Alert clearly matches a ticketable pattern (error, failure, security, user-impacting)
- LOW: Ambiguous severity, might be noise, or insufficient context to determine action

STEP 4 - Respond:
- If LOW confidence:
  - Explain why this alert is ambiguous
  - Final line must be [LOW_CONFIDENCE]
- If HIGH confidence:
  - Create a Jira ticket with appropriate fields
  - Explain your reasoning
  - Final line must be [CONFIDENCE: HIGH]

JIRA CONFIGURATION:
Project: {jira_project}
{jira_config_str}

ALERT DETAILS:
Bot: {bot_username}
Channel ID: {channel_id}
Text: {alert_text}
Timestamp: {timestamp}
Blocks: {alert_blocks}
Attachments: {alert_attachments}""",
        )
    )

    default_ai_alerts_prompt: str = Field(
        default_factory=lambda: os.environ.get(
            "SLACK_INTEGRATION_PROMPT_AI_ALERTS",
            """You are an automated incident management and feedback tracking system that creates Jira tickets for alerts and user feedback.

Your task: Analyze this alert/feedback and determine the appropriate action (create ticket, resolve ticket, or no action).

JIRA CONFIGURATION (use these exact fields when creating the ticket):
Project: {jira_project}
{jira_config_str}

CREATE A TICKET IF:
- System failure, error, or degradation
- Pipeline/build failure needing investigation
- Security alert or compliance issue
- Production incident or outage
- Requires human action or investigation
- Alert color is red (ff0000, danger), yellow (ff9900, warning), or similar error colors
- **USER FEEDBACK with issues or improvement requests**
- Feedback that mentions problems, errors, confusion, or missing content
- When in doubt about severity, CREATE THE TICKET

DO NOT CREATE A TICKET IF:
- Informational notification (oncall changes, deployments, status updates)
- Routine automated message
- Test/development environment alert (unless critical)
- **Positive feedback only** (thumbs up, high ratings like 5/5 with no issues mentioned)

ALERT DETAILS:
Bot: {bot_username}
Channel ID: {channel_id}
Text: {alert_text}
Timestamp: {timestamp}
Blocks: {alert_blocks}
Attachments: {alert_attachments}

INSTRUCTIONS:
1. **Analysis**: Explain your reasoning - why does/doesn't this alert warrant a ticket?
2. **Duplicate Check**: Search for existing tickets with the same core pattern
3. **Action**: State what you did (created ticket X, updated ticket Y, or no action needed)""",
        )
    )


class VictorOpsEscalation(BaseModel):
    """VictorOps on-call escalation configuration"""

    enabled: bool = False
    team: str = ""


class EmojiEscalation(BaseModel):
    """Emoji reaction escalation configuration"""

    enabled: bool = False
    name: str = "eyes"


class EscalationConfig(BaseModel):
    """Escalation workflows triggered by the 'Get help' button"""

    victorops: VictorOpsEscalation = Field(default_factory=VictorOpsEscalation)
    users: List[str] = Field(default_factory=list)
    emoji: EmojiEscalation = Field(default_factory=EmojiEscalation)
    delete_admins: List[str] = Field(default_factory=list)


def get_escalation_config(default_config: Dict[str, Any]) -> Optional["EscalationConfig"]:
    """Extract and parse escalation config from a channel's default dict."""
    raw = default_config.get("escalation")
    if not raw:
        return None
    return EscalationConfig(**raw)


class OverthinkConfig(BaseModel):
    """Overthink mode configuration — shared by Q&A and AI alerts."""

    enabled: bool = False
    skip_markers: List[str] = Field(default_factory=lambda: ["DEFER", "LOW_CONFIDENCE"])
    pass_marker: str = "CONFIDENCE: HIGH"
    custom_prompt: Optional[str] = None
    followup_prompt: Optional[str] = None


class IncludeBotsConfig(BaseModel):
    """Configuration for including bot messages"""

    enabled: bool = False
    bot_list: Optional[List[str]] = None


class QandaConfig(BaseModel):
    """Q&A mode configuration"""

    enabled: bool = False
    overthink: OverthinkConfig = Field(default_factory=OverthinkConfig)
    include_bots: IncludeBotsConfig = Field(default_factory=IncludeBotsConfig)
    custom_prompt: Optional[str] = None


class AIAlertsConfig(BaseModel):
    """AI alerts configuration"""

    enabled: bool = False
    overthink: OverthinkConfig = Field(default_factory=OverthinkConfig)
    custom_prompt: Optional[str] = None


class ChannelConfig(BaseModel):
    """Configuration for a single Slack channel"""

    name: str
    ai_enabled: bool = False
    custom_prompt: Optional[str] = None
    qanda: QandaConfig = Field(default_factory=QandaConfig)
    ai_alerts: AIAlertsConfig = Field(default_factory=AIAlertsConfig)
    default: Dict[str, Any]

    @model_validator(mode="after")
    def validate_bot_config(self):
        """Ensure ai_alerts and qanda.include_bots are not both enabled"""
        if self.ai_alerts.enabled and (self.qanda.enabled and self.qanda.include_bots.enabled):
            raise ValueError(
                "Cannot enable both ai_alerts and qanda.include_bots for the same channel. "
                "ai_alerts processes bot messages (alerts) to take action, "
                "while qanda.include_bots also processes bot messages for Q&A style responses. "
                "Choose one based on your use case."
            )
        return self


class Config(BaseModel):
    """Top-level configuration"""

    defaults: GlobalDefaults = Field(default_factory=GlobalDefaults)
    channels: Dict[str, ChannelConfig]
    silence_env: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        """Load config from CAIPE_BOT_CONFIG environment variable (YAML format)"""
        import yaml

        config_str = os.environ.get("SLACK_INTEGRATION_BOT_CONFIG", os.environ.get("CAIPE_BOT_CONFIG"))
        if not config_str:
            raise ValueError("SLACK_INTEGRATION_BOT_CONFIG (or CAIPE_BOT_CONFIG) environment variable not set")
        raw_config = yaml.safe_load(config_str)

        # Parse channels
        channels = {}
        for channel_id, channel_data in raw_config.items():
            channels[channel_id] = ChannelConfig(**channel_data)

        silence_env = os.environ.get("SLACK_INTEGRATION_SILENCE_ENV", "false").lower() == "true"

        return cls(channels=channels, silence_env=silence_env)

    def apply_defaults_to_channels(self):
        """Apply global defaults to channel configs (e.g., default prompts with style)"""
        for channel_config in self.channels.values():
            # --- Q&A prompt resolution ---
            custom_prompt = channel_config.qanda.custom_prompt
            overthink = channel_config.qanda.overthink

            if overthink.enabled:
                # Use overthink-specific prompt from config, or channel custom_prompt, or global default
                overthink_prompt = overthink.custom_prompt or self.defaults.overthink_qanda_prompt
                if custom_prompt and not overthink.custom_prompt:
                    channel_config.qanda.custom_prompt = (
                        overthink_prompt
                        + "\n\n---\n\n"
                        + "Additional channel-specific instructions (lower priority than the above overthink logic):\n"
                        + custom_prompt
                    )
                else:
                    channel_config.qanda.custom_prompt = overthink_prompt
                # Set default followup prompt if not configured
                if not overthink.followup_prompt:
                    overthink.followup_prompt = self.defaults.humble_followup_prompt
            elif not custom_prompt:
                channel_config.qanda.custom_prompt = self.defaults.default_qanda_prompt
            else:
                if self.defaults.response_style_instruction not in custom_prompt:
                    channel_config.qanda.custom_prompt = (
                        custom_prompt + "\n\n" + self.defaults.response_style_instruction
                    )

            # --- AI alerts prompt resolution ---
            alerts_overthink = channel_config.ai_alerts.overthink
            if alerts_overthink.enabled:
                alerts_prompt = alerts_overthink.custom_prompt or self.defaults.overthink_ai_alerts_prompt
                alerts_custom = channel_config.ai_alerts.custom_prompt
                if alerts_custom and not alerts_overthink.custom_prompt:
                    channel_config.ai_alerts.custom_prompt = (
                        alerts_prompt
                        + "\n\n---\n\n"
                        + "Additional channel-specific instructions:\n"
                        + alerts_custom
                    )
                else:
                    channel_config.ai_alerts.custom_prompt = alerts_prompt
                # Set default followup prompt if not configured
                if not alerts_overthink.followup_prompt:
                    alerts_overthink.followup_prompt = self.defaults.humble_followup_prompt
