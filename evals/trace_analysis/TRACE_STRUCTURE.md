# Langfuse TraceWithFullDetails Structure Reference

## Overview
The `langfuse.api.trace.get(trace_id)` method returns a **TraceWithFullDetails** Pydantic model with the following structure:

## Main Trace Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | str | ✅ | Unique trace identifier |
| `timestamp` | datetime | ✅ | When trace was created |
| `name` | str | ❌ | Human-readable trace name |
| `input` | Any | ❌ | Trace input data |
| `output` | Any | ❌ | Trace output data |
| `session_id` | str | ❌ | Session identifier |
| `user_id` | str | ❌ | User identifier |
| `metadata` | Any | ❌ | Custom metadata dictionary |
| `tags` | List[str] | ❌ | Tag labels |
| `public` | bool | ❌ | Whether trace is public |
| `environment` | str | ❌ | Environment (prod, dev, etc.) |
| `release` | str | ❌ | Release version |
| `version` | str | ❌ | Trace version |
| `html_path` | str | ✅ | Path to HTML view |
| `latency` | float | ✅ | Total trace latency |
| `total_cost` | float | ✅ | Total cost for trace |

## Observations Array
Each trace contains an `observations` array with the following structure:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | str | ✅ | Observation identifier |
| `trace_id` | str | ✅ | Parent trace ID |
| `type` | str | ✅ | GENERATION, SPAN, or EVENT |
| `name` | str | ❌ | Observation name |
| `start_time` | datetime | ✅ | Start timestamp |
| `end_time` | datetime | ❌ | End timestamp |
| `completion_start_time` | datetime | ❌ | When completion started |
| `model` | str | ❌ | Model name (for generations) |
| `model_parameters` | dict | ❌ | Model configuration |
| `input` | Any | ❌ | Input data |
| `output` | Any | ❌ | Output data |
| `metadata` | Any | ❌ | Custom metadata |
| `usage` | dict | ❌ | Token/cost usage (deprecated) |
| `usage_details` | dict | ❌ | Detailed usage metrics |
| `cost_details` | dict | ❌ | Detailed cost breakdown |
| `level` | str | ✅ | DEBUG, DEFAULT, WARNING, ERROR |
| `status_message` | str | ❌ | Status or error message |
| `parent_observation_id` | str | ❌ | Parent observation ID |
| `prompt_id` | str | ❌ | Associated prompt ID |
| `prompt_name` | str | ❌ | Prompt name |
| `prompt_version` | int | ❌ | Prompt version |
| `latency` | float | ❌ | Observation latency |
| `time_to_first_token` | float | ❌ | Time to first token |

## Scores Array
Each trace contains a `scores` array with evaluation results:

### Numeric Scores
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | str | ✅ | Score identifier |
| `trace_id` | str | ✅ | Parent trace ID |
| `name` | str | ✅ | Score name/type |
| `value` | float | ✅ | Numeric score value |
| `source` | str | ✅ | ANNOTATION, API, or EVAL |
| `observation_id` | str | ❌ | Associated observation |
| `timestamp` | datetime | ✅ | Score timestamp |
| `created_at` | datetime | ✅ | Creation time |
| `updated_at` | datetime | ✅ | Last update time |
| `author_user_id` | str | ❌ | Score author |
| `comment` | str | ❌ | Score comment |
| `metadata` | Any | ❌ | Custom metadata |
| `config_id` | str | ❌ | Score config ID |
| `queue_id` | str | ❌ | Annotation queue ID |
| `environment` | str | ❌ | Environment |
| `data_type` | str | ✅ | "NUMERIC" |

### Categorical/Boolean Scores
Similar to numeric scores but with additional:
- `string_value` (str): String representation of categorical/boolean value

## Usage Examples

```python
from langfuse import Langfuse
from trace_analysis.extractor import TraceExtractor

# Initialize
langfuse = Langfuse(public_key="pk-lf-...", secret_key="sk-lf-...")
extractor = TraceExtractor(langfuse)

# Fetch trace
trace = extractor.get_trace("trace-id")

# Access main fields
print(f"Trace ID: {trace.id}")
print(f"Name: {trace.name}")
print(f"User: {trace.user_id}")
print(f"Cost: ${trace.total_cost}")

# Process observations
for obs in trace.observations:
    print(f"Observation: {obs.type} - {obs.name}")
    if obs.type == "GENERATION":
        print(f"  Model: {obs.model}")
        if obs.usage_details:
            print(f"  Tokens: {obs.usage_details}")
    
# Process scores
for score in trace.scores:
    print(f"Score: {score.name} = {score.value}")
    if score.comment:
        print(f"  Comment: {score.comment}")

# Convert to dictionary
trace_dict = trace.dict()
trace_json = trace.json()
```

## Notes
- All optional fields may be `None` 
- The `observations` array contains the detailed execution flow
- The `scores` array contains evaluation results 
- Use `.dict()` or `.json()` methods to convert to standard formats
- Field names use snake_case in Python but camelCase in JSON schema