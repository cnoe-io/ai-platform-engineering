% Minimal ASP policy for PolicyMiddleware unit tests (github subagent).
% Deny-by-default: AllowFact is emitted only for the gh-backed GitHub tools.

% --- GitHub agent tools ---
% gh_cli_execute performs command-level write gating in the tool implementation.
readonly(gh_cli_execute).
readonly(get_file_contents).

allow(Tool, Agent) :-
    tool_call(Tool, Agent),
    agent_type(Agent, subagent),
    readonly(Tool).
