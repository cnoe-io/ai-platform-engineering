% Test policy – mirrors production GitHub subagent restrictions.
%
% Facts provided by Python at evaluation time (as unquoted constants):
%   tool_call(ToolName, AgentName).
%   agent_type(AgentName, Type).       % deep_agent | subagent
%   self_service_mode.                  % present only when active

% 1. Deep agents (supervisors) can use any tool
allow(Tool, Agent) :- tool_call(Tool, Agent), agent_type(Agent, deep_agent).

% 2. Non-github subagents can use any tool
allow(Tool, Agent) :- tool_call(Tool, Agent), agent_type(Agent, subagent), Agent != github.

% 3. GitHub read-only tools – always allowed
github_readonly(get_me).
github_readonly(get_team_members).
github_readonly(get_teams).
github_readonly(get_label).
github_readonly(issue_read).
github_readonly(list_issue_types).
github_readonly(list_issues).
github_readonly(search_issues).
github_readonly(list_pull_requests).
github_readonly(pull_request_read).
github_readonly(search_pull_requests).
github_readonly(get_commit).
github_readonly(get_file_contents).
github_readonly(get_latest_release).
github_readonly(get_release_by_tag).
github_readonly(get_tag).
github_readonly(list_branches).
github_readonly(list_commits).
github_readonly(list_releases).
github_readonly(list_tags).
github_readonly(search_code).
github_readonly(search_repositories).
github_readonly(search_users).

allow(Tool, Agent) :- tool_call(Tool, Agent), Agent = github, github_readonly(Tool).

% 4. Built-in tools – always allowed for any agent
builtin_tool(write_todos).
builtin_tool(task).
builtin_tool(read_file).
builtin_tool(write_file).
builtin_tool(ls).
builtin_tool(grep).
builtin_tool(glob).
builtin_tool(edit_file).
builtin_tool(tool_result_to_file).
builtin_tool(wait).
builtin_tool(invoke_self_service_task).

allow(Tool, Agent) :- tool_call(Tool, Agent), builtin_tool(Tool).

% 5. GitHub self-service tools – only with self_service_mode
github_self_service(create_repository).
github_self_service(create_pull_request).
github_self_service(create_branch).
github_self_service(create_or_update_file).
github_self_service(push_files).
github_self_service(fork_repository).

allow(Tool, Agent) :- tool_call(Tool, Agent), Agent = github, github_self_service(Tool), self_service_mode.

% 6. Write tools for github have no rule => denied by default
