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

% 3. GitHub agent tools – always allowed; gh_cli_execute performs command-level
% write gating in the tool implementation.
github_readonly(gh_cli_execute).
github_readonly(get_file_contents).
github_self_service_only(create_or_update_file).

allow(Tool, Agent) :- tool_call(Tool, Agent), Agent = github, github_readonly(Tool).
allow(Tool, Agent) :-
    tool_call(Tool, Agent),
    Agent = github,
    github_self_service_only(Tool),
    self_service_mode.

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

% 5. Removed GitHub MCP tools have no rule => denied by default
