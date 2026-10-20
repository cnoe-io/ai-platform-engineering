---
sidebar_position: 6
---

# Organize chat history

The chat sidebar offers three views alongside the existing chat-type filter:

- **Ungrouped**: the current conversation list, including chats assigned to folders.
- **Group by agent**: a collapsible group for each agent represented in the loaded history.
- **Folders**: personal folders and an **Unfiled** group.

Use **New chat folder** to create a folder. Hover or focus a conversation's
folder button to move it. Folder headers support collapse, rename and removal.
Removing a folder returns its chats to Unfiled; it does not archive chats.

Folders, assignments, view selection and collapsed groups are saved in the
signed-in user's `user_settings.preferences.chat_history`. They do not change
conversation ownership, sharing or agent access. Browser-only installations
store the same preferences locally, scoped to the current account.

Grouping applies to the current chat-type filter and loaded pages. Use **Load
older chats** to include more history, including when all groups are collapsed.
Folder assignments for older, unloaded chats remain saved.

The preferences API validates folder IDs, unique names, assignments and limits
before saving. Limits are 100 folders, 80 characters per name and 10,000 saved
assignments. No migration of existing conversations is required. An account
without organization preferences starts in Ungrouped view.
