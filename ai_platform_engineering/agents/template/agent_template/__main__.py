from .agent_template import agent

# Run the agent with a sample query
result = agent.invoke({
  "messages": [
    {
      "role": "user",
      "content": "Where should I hike in Texas today?"
    }
  ]
})

print(result.get("messages", []))
