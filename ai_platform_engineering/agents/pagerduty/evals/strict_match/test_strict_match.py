import pytest
from agentevals.strict_match import StrictMatchEvaluator
from agent_pagerduty.agent import PagerDutyAgent

@pytest.mark.evals
def test_basic_incident_query():
    agent = PagerDutyAgent()
    evaluator = StrictMatchEvaluator()
    
    test_cases = [
        {
            "query": "Show me all high-priority incidents",
            "expected_contains": ["priority", "high", "incidents"]
        },
        {
            "query": "List open incidents assigned to me",
            "expected_contains": ["status", "open", "assigned"]
        }
    ]
    
    for test_case in test_cases:
        response = agent.run(test_case["query"])
        assert evaluator.evaluate(response, test_case["expected_contains"]) 