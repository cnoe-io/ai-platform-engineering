"""
Webex message context utilities.

Handles message text extraction, @mention stripping, and thread key generation.
"""

import re


def extract_message_text(message_obj) -> str:
    """Extract clean text from a Webex message, stripping @mentions in group spaces.

    Args:
        message_obj: webexteamssdk Message object

    Returns:
        Clean message text with bot mentions removed.
    """
    text = message_obj.text or ""

    if getattr(message_obj, "roomType", "") == "group" and text:
        # In group spaces, the bot name appears as a prefix before the actual message.
        # The text field contains the mention as plain text, e.g. "BotName some question"
        # We strip it using the html field which wraps the mention in <spark-mention>.
        html = getattr(message_obj, "html", "") or ""
        if "<spark-mention" in html:
            # Remove everything up to and including the closing </spark-mention> tag
            # and any leading whitespace after it
            text = re.sub(r"^.*?</spark-mention>\s*", "", html, count=1)
            # Strip remaining HTML tags
            text = re.sub(r"<[^>]+>", "", text).strip()
        else:
            # Fallback: remove the first word (likely the bot name)
            parts = text.split(None, 1)
            text = parts[1] if len(parts) > 1 else text

    return text.strip()


def get_thread_key(message_obj) -> str:
    """Generate a session thread key from a Webex message.

    For 1:1 spaces: uses roomId
    For group spaces with threading: uses roomId:parentId
    For group spaces without threading: uses roomId:messageId (starts new thread)

    Args:
        message_obj: webexteamssdk Message object

    Returns:
        Thread key string for session lookup.
    """
    room_id = message_obj.roomId
    room_type = getattr(message_obj, "roomType", "direct")

    if room_type == "direct":
        return room_id

    # Group space: use parentId if this is a threaded reply
    parent_id = getattr(message_obj, "parentId", None)
    if parent_id:
        return f"{room_id}:{parent_id}"

    # Group space, top-level message: use the message's own ID as thread root
    return f"{room_id}:{message_obj.id}"


def is_direct_message(message_obj) -> bool:
    """Check if a message is a 1:1 direct message."""
    return getattr(message_obj, "roomType", "") == "direct"
