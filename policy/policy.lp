% Policy for tool call authorization
% Default: deny all tool calls unless explicitly allowed
%
% This file defines the authorization policy for tool calls in the
% AI Platform Engineering multi-agent system using Answer Set Programming (ASP).
%
% The PolicyMiddleware evaluates tool calls against this policy using Clingo/Clorm.

% === Facts provided by Python ===
% tool_call(ToolName, AgentName).
% agent_type(AgentName, Type).  % Type: deep_agent | subagent
% self_service_mode.            % Present when running in self-service workflow

% === Read-Only GitHub MCP Tools (Always Allowed) ===

% User/Team tools
readonly_tool(get_me).
readonly_tool(get_team_members).
readonly_tool(get_teams).

% Issue read tools
readonly_tool(get_label).
readonly_tool(issue_read).
readonly_tool(list_issue_types).
readonly_tool(list_issues).
readonly_tool(search_issues).

% Pull request read tools
readonly_tool(list_pull_requests).
readonly_tool(pull_request_read).
readonly_tool(search_pull_requests).

% Repository read tools
readonly_tool(get_commit).
readonly_tool(get_file_contents).
readonly_tool(get_latest_release).
readonly_tool(get_release_by_tag).
readonly_tool(get_tag).
readonly_tool(list_branches).
readonly_tool(list_commits).
readonly_tool(list_releases).
readonly_tool(list_tags).
readonly_tool(search_code).
readonly_tool(search_repositories).

% User search
readonly_tool(search_users).

% === Self-Service Mode Tools (Only in Self-Service Workflows) ===
% These tools are allowed when running via invoke_self_service_task

self_service_tool(create_repository).
self_service_tool(create_pull_request).
self_service_tool(create_branch).
self_service_tool(create_or_update_file).
self_service_tool(push_files).
self_service_tool(fork_repository).
self_service_tool(merge_pull_request).

% === Built-in Deep Agent Tools (Always Allowed) ===
% These are tools provided by the deep agent framework

builtin_tool(write_todos).
builtin_tool(task).
builtin_tool(read_file).
builtin_tool(write_file).
builtin_tool(ls).
builtin_tool(grep).
builtin_tool(glob).
builtin_tool(edit_file).
builtin_tool(tool_result_to_file).
builtin_tool(reflect_on_output).
builtin_tool(format_markdown).
builtin_tool(fetch_url).
builtin_tool(get_current_date).
builtin_tool(jq).
builtin_tool(yq).
builtin_tool(wait).
builtin_tool(invoke_self_service_task).
builtin_tool(list_self_service_tasks).

% === Non-GitHub Agents ===
% These agents have their own MCP tools that should be allowed

non_github_agent(jira).
non_github_agent(webex).
non_github_agent(argocd).
non_github_agent(backstage).
non_github_agent(aigateway).
non_github_agent(pagerduty).
non_github_agent(slack).
non_github_agent(splunk).
non_github_agent(komodor).
non_github_agent(confluence).
non_github_agent(aws).
non_github_agent(caipe).

% === Authorization Rules ===

% Allow read-only GitHub tools for all agents
allow(Tool, Agent) :- tool_call(Tool, Agent), readonly_tool(Tool).

% Allow built-in framework tools for all agents
allow(Tool, Agent) :- tool_call(Tool, Agent), builtin_tool(Tool).

% Allow self-service tools only when self_service_mode is active
allow(Tool, Agent) :- tool_call(Tool, Agent), self_service_tool(Tool), self_service_mode.

% Allow all tools for deep_agent supervisor (it orchestrates subagents)
allow(Tool, Agent) :- tool_call(Tool, Agent), agent_type(Agent, deep_agent).

% Allow all tools for non-GitHub agents
allow(Tool, Agent) :- tool_call(Tool, Agent), non_github_agent(Agent).

% === Default Deny ===
% Tool is denied if not explicitly allowed (closed-world assumption)
deny(Tool, Agent) :- tool_call(Tool, Agent), not allow(Tool, Agent).
