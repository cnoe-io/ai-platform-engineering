---
sidebar_position: 6
---

# CAIPE Labs Conclusion

You've completed the CAIPE Labs series. This page summarizes what you learned and gives you a single set of prompts and checks to verify your setup end-to-end.

## What You Covered

| Part | Module | What you did |
|------|--------|----------------|
| 1 | [Introduction to AI Agents](/workshop/agent) | Built a ReAct agent with LangChain and MCP tools |
| 2 | [Multi-Agent Systems](/workshop/mas) | Deployed CAIPE on Kubernetes and coordinated weather and NetUtils agents |
| 3 | [RAG and Git Agents](/workshop/rag) | Added a RAG stack, ingested docs, and queried the knowledge base |
| 4 | [Tracing](/workshop/tracing) | Deployed Langfuse and traced multi-agent requests |

Together, these modules gave you hands-on experience with the ReAct pattern, MCP, A2A, RAG, and observability—the core building blocks of production agent systems.

## One Setup, One Script

For a full environment (Kind, CAIPE, optional RAG and tracing) from a single flow, use the setup script at the repository root:

```bash
./setup-caipe.sh
```

It guides you through cluster choice, LLM provider, credentials, and optional RAG and tracing. Non-interactive usage:

```bash
./setup-caipe.sh --non-interactive --create-cluster --rag --tracing
```

See [Run with KinD](/getting-started/kind/setup) for full options and reference.

## Canonical Test Prompts

Use these same prompts across CAIPE Labs to verify behavior and to compare UI output with traces in Langfuse.

**1. Discover agents**
```text
What agents are available?
```

**2. Weather**
```text
What's the current weather in San Francisco?
```

**3. Network**
```text
Check if google.com is reachable.
```

**4. Cross-agent (weather + network)**
```text
Get me today's weather for New York, and also test if api.github.com is reachable. Summarize both results.
```

**5. RAG (if enabled)**  
In the CAIPE UI, ask about whatever you ingested (e.g. CAIPE or AGNTCY docs), for example:
```text
What is CAIPE and how do I deploy it?
```

Run 1–4 in the CAIPE UI (and optionally in the agent-chat CLI). In Langfuse you should see the supervisor routing to the weather and NetUtils agents and synthesizing the answer. Use the same prompts in Part 2 (MAS) and Part 4 (Tracing) for a consistent experience.

## Quick Verification Checklist

- [ ] Supervisor and UI are reachable (port-forwards or ingress).
- [ ] "What agents are available?" returns weather and NetUtils (and RAG if enabled).
- [ ] Weather and network prompts return sensible answers.
- [ ] Cross-agent prompt returns a combined summary.
- [ ] If RAG is enabled: KB search and chat use the ingested docs.
- [ ] If tracing is enabled: Langfuse shows traces for the same prompts with spans for supervisor and sub-agents.

## Next Steps

- Explore more agents and MCP servers in the [CAIPE repo](https://github.com/cnoe-io/ai-platform-engineering).
- Read the [KinD setup](/getting-started/kind/setup) and [LLM configuration](/getting-started/kind/configure-llms) docs for production-like options.
- Join the [CNOE community](https://github.com/cnoe-io/ai-platform-engineering#community) for support and roadmap updates.

Thank you for completing CAIPE Labs.
