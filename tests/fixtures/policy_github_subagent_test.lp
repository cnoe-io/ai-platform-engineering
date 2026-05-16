% Minimal ASP policy for PolicyMiddleware unit tests (github subagent).
% Deny-by-default: AllowFact is emitted only for listed read-only tools,
% or for self-service tools when self_service_mode is present.

% --- Read-only GitHub MCP tools (subset matching test_readonly_tools_allowed_for_github) ---
readonly(get_me).
readonly(get_team_members).
readonly(get_teams).
readonly(get_label).
readonly(issue_read).
readonly(list_issue_types).
readonly(list_issues).
readonly(search_issues).
readonly(list_pull_requests).
readonly(pull_request_read).
readonly(search_pull_requests).
readonly(get_commit).
readonly(get_file_contents).
readonly(get_latest_release).
readonly(get_release_by_tag).
readonly(get_tag).
readonly(list_branches).
readonly(list_commits).
readonly(list_releases).
readonly(list_tags).
readonly(search_code).
readonly(search_repositories).
readonly(search_users).

% --- Self-service tools (allowed only with self_service_mode fact) ---
self_service_tool(create_repository).
self_service_tool(create_pull_request).
self_service_tool(create_branch).
self_service_tool(create_or_update_file).
self_service_tool(push_files).
self_service_tool(fork_repository).

allow(Tool, Agent) :-
    tool_call(Tool, Agent),
    agent_type(Agent, subagent),
    readonly(Tool).

allow(Tool, Agent) :-
    tool_call(Tool, Agent),
    agent_type(Agent, subagent),
    self_service_mode,
    self_service_tool(Tool).
