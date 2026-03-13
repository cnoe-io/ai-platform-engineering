% Stub policy — production policy is managed in platform-apps-deployment
% and overrides this via the Helm policyConfig value.
%
% This stub allows ALL tool calls for local development/testing.

% === Facts provided by Python ===
% tool_call(ToolName, AgentName).
% agent_type(AgentName, Type).
% self_service_mode.

% Allow everything
allow(Tool, Agent) :- tool_call(Tool, Agent).
