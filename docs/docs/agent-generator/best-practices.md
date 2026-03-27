# Best Practices

Guidelines for creating effective and maintainable agent manifests.

## Agent Design

### Choose Clear, Descriptive Names

**Good:**
```yaml
metadata:
  name: "weather"
  display_name: "Weather Information Agent"
```

**Bad:**
```yaml
metadata:
  name: "WEA"
  display_name: "Agent1"
```

**Why:** Clear names make agents easier to discover and understand.

---

### Write Comprehensive Descriptions

**Good:**
```yaml
metadata:
  description: "An intelligent weather agent that provides real-time weather information, forecasts, and climate data analysis for locations worldwide using the OpenWeatherMap API"
```

**Bad:**
```yaml
metadata:
  description: "Weather agent"
```

**Why:** Detailed descriptions help users understand what the agent does and when to use it.

---

### Define Clear, Focused Skills

**Good:**
```yaml
skills:
  - id: "weather_current"
    name: "Current Weather"
    description: "Get real-time weather conditions including temperature, humidity, wind speed, and precipitation for any location"
    examples:
      - "What's the weather in Tokyo?"
      - "Tell me the current temperature in London"
      - "Is it raining in Seattle right now?"
  
  - id: "weather_forecast"
    name: "Weather Forecast"
    description: "Get detailed weather forecasts for up to 7 days ahead"
    examples:
      - "What's the forecast for this weekend in Paris?"
      - "Will it rain tomorrow in Boston?"
      - "Show me the 5-day forecast for Miami"
```

**Bad:**
```yaml
skills:
  - id: "weather"
    name: "Weather"
    description: "Weather stuff"
    examples:
      - "Weather"
```

**Why:** Clear, focused skills with good examples improve agent usability and LLM performance.

---

## Examples

### Provide Diverse, Realistic Examples

**Good:**
```yaml
examples:
  - "What's the weather like in San Francisco?"
  - "Tell me the temperature in Tokyo"
  - "Is it raining in London right now?"
  - "What's the forecast for this weekend?"
  - "Will I need an umbrella tomorrow?"
  - "Show me the 5-day forecast for Seattle"
```

**Why:** Diverse examples help the LLM understand the full range of queries the skill can handle.

### Include Different Query Patterns

Include examples with:
- Direct questions ("What's the weather in Paris?")
- Implicit questions ("Will I need a jacket today?")
- Commands ("Show me the forecast")
- Natural language ("Is it going to rain tomorrow?")

---

## Dependencies

### Specify Version Constraints

**Good:**
```yaml
dependencies:
  - source: "pypi"
    name: "requests"
    version: ">=2.31.0,<3.0.0"
```

**Bad:**
```yaml
dependencies:
  - source: "pypi"
    name: "requests"
    # No version specified
```

**Why:** Version constraints prevent compatibility issues and ensure reproducible builds.

---

### Document API Keys

**Good:**
```yaml
dependencies:
  - source: "openapi"
    name: "weather-api"
    url: "https://api.openweathermap.org/data/2.5/openapi.json"
    api_key_env_var: "WEATHER_API_KEY"

environment:
  - name: "WEATHER_API_KEY"
    description: "API key for OpenWeatherMap (get yours at https://openweathermap.org/api)"
    required: true
```

**Why:** Clear documentation helps users configure the agent correctly.

---

## Environment Variables

### Use Descriptive Names

**Good:**
```yaml
environment:
  - name: "WEATHER_API_KEY"
  - name: "WEATHER_API_URL"
  - name: "WEATHER_UNITS"
```

**Bad:**
```yaml
environment:
  - name: "KEY"
  - name: "URL"
  - name: "UNITS"
```

**Why:** Descriptive names prevent confusion, especially in environments with many variables.

---

### Provide Sensible Defaults

**Good:**
```yaml
environment:
  - name: "WEATHER_UNITS"
    description: "Unit system: metric, imperial, or standard"
    required: false
    default: "metric"
  
  - name: "WEATHER_API_URL"
    description: "Base URL for weather API"
    required: false
    default: "https://api.openweathermap.org/data/2.5"
```

**Why:** Defaults reduce configuration burden and provide working examples.

---

### Mark Required Variables Clearly

```yaml
environment:
  - name: "WEATHER_API_KEY"
    description: "API key for OpenWeatherMap (required)"
    required: true  # No default
  
  - name: "WEATHER_CACHE_TTL"
    description: "Cache time-to-live in seconds"
    required: false
    default: "300"
```

---

## Protocols and Transports

### Choose Appropriate Protocols

**For Simple Agents:**
```yaml
protocols:
  - a2a
transports:
  - http
```

**For Agents with Tool Integration:**
```yaml
protocols:
  - a2a
  - mcp
transports:
  - http
  - stdio
```

**Why:** MCP is beneficial when you need structured tool calling, while A2A is simpler for basic agents.

---

## Versioning

### Follow Semantic Versioning

```yaml
metadata:
  version: "0.1.0"  # Initial development
  version: "1.0.0"  # First stable release
  version: "1.1.0"  # New feature (backward compatible)
  version: "2.0.0"  # Breaking change
```

**Version Bumping:**
- **Patch (0.0.X):** Bug fixes, no API changes
- **Minor (0.X.0):** New features, backward compatible
- **Major (X.0.0):** Breaking changes

---

## Organization

### Group Related Skills

**Good:**
```yaml
skills:
  - id: "pet_management"
    name: "Pet Management"
    # ...
  
  - id: "order_management"
    name: "Order Management"
    # ...
  
  - id: "user_management"
    name: "User Management"
    # ...
```

**Why:** Logical grouping makes the agent easier to understand and maintain.

---

### Keep Manifests DRY

For agents with similar structure, consider:
1. Creating a template manifest
2. Using automation to generate variations
3. Maintaining a library of common skill definitions

---

## Testing

### Generate with Dry-Run First

```bash
agent-gen generate my-agent.yaml --dry-run
```

**Why:** Preview what will be generated before committing.

---

### Validate Early and Often

```bash
agent-gen validate my-agent.yaml
```

**Why:** Catch errors before generation.

---

### Test Generated Agents

After generation:

1. **Install dependencies:** `make uv-sync`
2. **Run locally:** `make run-a2a`
3. **Test with client:** `make run-a2a-client`
4. **Check all skills work correctly**

---

## Documentation

### Provide Context in README

The generated README is a template. Enhance it with:
- **Prerequisites:** What users need before using the agent
- **Configuration details:** Detailed environment variable documentation
- **Examples:** Real usage examples
- **Troubleshooting:** Common issues and solutions

---

### Maintain a Changelog

Update `CHANGELOG.md` with each version:

```markdown
## [0.2.0] - 2025-01-15

### Added
- Support for 7-day forecasts
- Hourly weather data

### Changed
- Updated API to v2.5

### Fixed
- Temperature conversion bug
```

---

## Performance

### Consider Agent Scope

**Good - Focused Agent:**
```yaml
metadata:
  name: "weather"
  description: "Weather information and forecasts"

skills:
  - id: "weather_current"
  - id: "weather_forecast"
```

**Bad - Too Broad:**
```yaml
metadata:
  name: "everything"
  description: "Does everything"

skills:
  - id: "weather"
  - id: "stocks"
  - id: "news"
  - id: "translation"
  # ... 20 more skills
```

**Why:** Focused agents are easier to maintain and perform better. Create multiple specialized agents instead of one monolithic agent.

---

## Security

### Never Hardcode Secrets

**Good:**
```yaml
environment:
  - name: "API_KEY"
    description: "API key for service"
    required: true
```

**Bad:**
```yaml
# Don't include actual keys in manifests
api_key: "sk-1234567890abcdef"
```

---

### Document Security Requirements

```yaml
environment:
  - name: "OAUTH_CLIENT_SECRET"
    description: "OAuth client secret (store securely, never commit to version control)"
    required: true
```

---

## Maintenance

### Keep Dependencies Up to Date

Periodically review and update:
```yaml
dependencies:
  - source: "pypi"
    name: "requests"
    version: ">=2.31.0,<3.0.0"  # Update when new versions are available
```

---

### Version Lock for Stability

For production agents, consider pinning exact versions:
```yaml
dependencies:
  - source: "pypi"
    name: "requests"
    version: "==2.31.0"
```

---

## Collaboration

### Use Tags for Discovery

```yaml
metadata:
  tags:
    - "weather"
    - "forecast"
    - "api"
    - "openweathermap"
    - "production"
```

**Why:** Tags help team members find and categorize agents.

---

### Include Author Information

```yaml
metadata:
  author: "Platform Team"
  author_email: "platform@company.com"
```

**Why:** Makes it easy to contact the maintainers.

---

## Summary Checklist

Before finalizing your manifest:

- [ ] Clear, descriptive agent name
- [ ] Comprehensive description (20+ characters)
- [ ] Each skill has 3+ examples
- [ ] Version constraints on all dependencies
- [ ] Required environment variables documented
- [ ] Sensible defaults for optional variables
- [ ] Appropriate protocol selection
- [ ] Semantic versioning
- [ ] Manifest validates successfully
- [ ] Dry-run generation successful
- [ ] Generated agent tested locally

---

## Next Steps

- [Examples](examples.md) - See complete manifest examples
- [Manifest Format](manifest-format.md) - Detailed format specification
- [CLI Reference](cli-reference.md) - Command-line interface documentation

