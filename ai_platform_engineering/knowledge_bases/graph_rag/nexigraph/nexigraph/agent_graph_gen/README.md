# Agent Graph Generation

## Testing and Evaluation



Run the tests using:

```bash
# First run the dependencies
docker-compose -f docker-compose-dependency.yaml up --build

# Heuristics E2E Test
uv run pytest test_heuristics_e2e.py --log-cli-level=INFO

# Evaluation E2E Test (runs 3 times, writes logs to `test_results_{i}.log` for each iteration, for comparison against previous runs)
uv run pytest test_evaluate_e2e.py --log-cli-level=INFO