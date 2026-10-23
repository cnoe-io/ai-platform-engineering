# Service-desk issue fallback

An agent can submit an approved support request even when the user's GitHub
connection cannot create issues. Enable the `service_desk` built-in tool on the
support agent and configure the UI's existing service-desk GitHub route.

1. Search for an existing issue when the user's GitHub tools are available.
2. Show the proposed title and description and obtain user approval.
3. Try the user's GitHub connection.
4. If the connection is unavailable or creation definitively returns 401, 403,
   or 404, call `submit_service_desk_ticket` with the same approved draft.
5. Return the actual issue link and explain that the service desk submitted it.

Do not switch credentials after a timeout or uncertain write: verify whether the
first request created an issue. If fallback submission fails, preserve the draft
and report the failure without claiming a ticket exists.

The server fixes the target repository, labels, assignee, and authenticated
reporter. The service credential is never available to the model. Normal GitHub
operations continue using the user's credential. Identical fallback submissions
in the same chat reuse the saved issue; unresolved submissions need operator
reconciliation before a retry.
