# Mission Check 7 — Tracing and Evaluation

In this mission, you’ll enable tracing with Langfuse and observe your app’s behavior end-to-end.

Steps:

<!-- ## 1. Log in to Langfuse

**[🚀 Click to open Langfuse](http://langfuse-web:3000/)**

   - Login to <http://langfuse-web:3000/>
       - **Email:**
       ```
       ```
       - **Password:**
        ```
        ```

## 2. Create an API key

   - In the Langfuse UI, create a new project with your username.

       -
   - Create API Key.
       -
   - Copy both the Secret and Public keys.
       -  -->

## 1. Configure your environment

- Change directory to `/home/ubuntu/work`
```bash
cd $HOME/work
```

- Clone repo
```bash
git clone https://github.com/cnoe-io/ai-platform-engineering
```

- Change directory to repo
```bash
cd $HOME/work/ai-platform-engineering
```

:::info
\1
:::

- Copy `.env.example` to `.env` if the file doesn't exist or is empty
```bash
if [ ! -f .env ] || [ ! -s .env ]; then
  cp .env.example .env
fi
```

### 1.2: Edit the environment file with your LLM credentials
```bash
source $HOME/.env_vars && \
sed -i \
  -e 's|^LLM_PROVIDER=.*|LLM_PROVIDER=azure-openai|' \
  -e "s|^AZURE_OPENAI_API_KEY=.*|AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY}|" \
  -e "s|^AZURE_OPENAI_ENDPOINT=.*|AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}|" \
  -e "s|^AZURE_OPENAI_DEPLOYMENT=.*|AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT}|" \
  -e "s|^AZURE_OPENAI_API_VERSION=.*|AZURE_OPENAI_API_VERSION=${AZURE_OPENAI_API_VERSION}|" \
  .env
```

```bash
PETSTORE_MCP_API_KEY=$(echo -n 'caiperocks' | sha256sum | cut -d' ' -f1) && \
sed -i "s|^PETSTORE_MCP_API_KEY=.*|PETSTORE_MCP_API_KEY=${PETSTORE_MCP_API_KEY}|" .env
```

```bash
WEATHER_MCP_API_KEY=$(echo -n 'caiperocks' | sha256sum | cut -d' ' -f1) && \
sed -i "s|^WEATHER_MCP_API_KEY=.*|WEATHER_MCP_API_KEY=${WEATHER_MCP_API_KEY}|" .env
```

```bash
COMPOSE_PROFILE="github,weather,tracing" docker compose up
```

- Check environment variable (partially masked)
```bash
cat .env | grep -Ei 'azure|github|langfuse' | sed -E 's/(=.{5}).+/\1****/'
```

-

- 1. Log in to Langfuse

**[🚀 Click to open Langfuse](http://langfuse-web:3000/)**

   - Create a new account with [http://langfuse-web:3000/](http://langfuse-web:3000/)
       - **Email:**
       - **Password:**

- 2. Create an API key

   - In the Langfuse UI, create a new project with your username.

       -
   - Create API Key.
       -
   - Copy both the Secret and Public keys.
       -


- Setup Langfuse environment variables
```bash
# Define key-value pairs
declare -A ENV_VARS=(
  ["ENABLE_TRACKING"]="true"
  ["LANGFUSE_TRACING_ENABLED"]="True"
  ["LANGFUSE_HOST"]="http://langfuse-web:3000"
)

# Update or append each key
for KEY in "${!ENV_VARS[@]}"; do
  VALUE="${ENV_VARS[$KEY]}"
  if grep -q "^${KEY}=" .env; then
    sed -i "s|^${KEY}=.*|${KEY}=${VALUE}|" .env
  else
    echo "${KEY}=${VALUE}" >> .env
  fi
done
```

- Setup LANGFUSE_SECRET_KEY
```bash
# LANGFUSE_SECRET_KEY
read -s -p "Enter your LANGFUSE_SECRET_KEY (pasted text won't show, just press enter): " LF_SEC_KEY; echo
export LANGFUSE_SECRET_KEY="$LF_SEC_KEY"
if grep -q "^LANGFUSE_SECRET_KEY=" .env; then
  sed -i "s|^LANGFUSE_SECRET_KEY=.*|LANGFUSE_SECRET_KEY=$LF_SEC_KEY|" .env
else
  echo "LANGFUSE_SECRET_KEY=$LF_SEC_KEY" >> .env
fi
```

- Setup LANGFUSE_PUBLIC_KEY
```bash
# LANGFUSE_PUBLIC_KEY
read -s -p "Enter your LANGFUSE_PUBLIC_KEY (pasted text won't show, just press enter): " LF_PUB_KEY; echo
export LANGFUSE_PUBLIC_KEY="$LF_PUB_KEY"
if grep -q "^LANGFUSE_PUBLIC_KEY=" .env; then
  sed -i "s|^LANGFUSE_PUBLIC_KEY=.*|LANGFUSE_PUBLIC_KEY=$LF_PUB_KEY|" .env
else
  echo "LANGFUSE_PUBLIC_KEY=$LF_PUB_KEY" >> .env
fi
```

- Check environment variable (partially masked)
```bash
cat .env | grep -Ei 'azure|github|langfuse' | sed -E 's/(=.{5}).+/\1****/'
```

## 4. Start Mission 7 services

**Run:**

```bash
IMAGE_TAG=latest ENABLE_TRACING=true LANGFUSE_SECRET_KEY=$LANGFUSE_SECRET_KEY LANGFUSE_PUBLIC_KEY=$LANGFUSE_PUBLIC_KEY LANGFUSE_HOST=http://langfuse-web:3000 COMPOSE_PROFILE="weather,tracing" docker compose up -d
```

```bash
COMPOSE_PROFILE="github,weather,tracing" docker compose logs -f
```

## 5. Run the chat CLI and make an example query

**Run:**


```bash
docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
```

> Tip
> When asked to `💬 Enter token (optional): `, just press enter ⏎.
>
> In production, your system will use a JWT or Bearer token for authentication here.

:::

![chatcli token](images/chat-cli-token.svg)

- Ask a question:

```bash
What's the weather in london?
```

```bash
show my github info
```

```bash
How is the weather in San Jose? and tabule github activity in cnoe-io org and compare it with 5 day forecast
```

## 6. View the trace in Langfuse

**[🚀 Open Langfuse Observability Dashboard](http://langfuse-web:3000/)**

   - Return to the Langfuse dashboard.
   - Open Traces and find the new trace for your query.
   - Explore the spans, inputs/outputs, and timing.