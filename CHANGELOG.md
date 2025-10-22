## Unreleased

### Feat

- **helm**: Add flexible prompt configuration with default and deep agent modes
- up to date helm and external secrets doc
- **helm**: add promptConfig override support
- adding job termination, reload and search weights
- add mcp server for RAG
- add Claude Agent SDK template with A2A and MCP protocol bindings
- add dev version of complete
- allow supervisor agent to work with any remote agent
- add condition to rag-stack and fix webui;
- new rag-stack chart
- add agent_skill_examples in prompt_config
- add ENABLE_<agent> to supervisor cm
- use skills example config
- agent-rag can now filter
- dynamic docker-compose generation with persona-based profiles
- add dynamic docker-compose generator and persona configuration
- add agent-aws-slim and agent-petstore-slim services

### Fix

- better idpbuilder docs;
- **docs**: gh pages
- RAG ingestion and retrieval bug fixes
- **ci**: Correct dependency verification pattern for helm packages
- **ci**: Skip version check when only Chart.lock changes
- **helm**: skip packaging if chart version already published
- **helm**: ensure rag-stack dependencies always packaged in ai-platform-engineering
- lint and tests
- webui improvements
- uv-lock
- RAG tests; add url santization
- **docs**: use idpbuilder scripts from git repo
- **gha**: updates
- **gha**: updates
- **gha**: updates
- **lint**: updates
- **unit-tests**: updates
- **unit-tests**: multi-agent tests
- **gha**: update supervisor ci name
- **unit tests**: clean-up
- **gha**: build on .github changes
- **gha**: build on .github changes
- **gha**: build on .github changes
- **gha**: update names
- working docker-compose.caipe-complete-with-tracing
- correctly handle aws bedrock streaming format
- rufflint
- make AWS agent to run in executor to prevent blocking
- make supervisor agent work dynamically
- rufflint
- remove empty file
- use fields from pydantic model
- **rag**: add init tests, add delete_all function
- **docker-compose**: use latest
- remove unnecessary files
- optimise search with weighted ranker
- fix
- delete ai.yaml
- no rag name or
- rag-stack needs agentExports
- add rag to supervisor cm
- wrong env place
- fix
- all neo4j hardcoded to port 7687
- handle when chart does not exist in main yet
- update chart version correctly for pre-release
- **README.md**: re-trigger build
- **README.md**: re-trigger the build
- **.dockerignore**: include all rag sources
- **README.md**: retrigger build
- exclude from supervisor, but include clients
- remove `knowledge-bases` .dockerignore
- change to .gitleaksignore
- add nosec to neo4j instantation
- lint
- **rag**: webui nginx; logging; prompt improvements
- agent_rag footnote for filtering
- code comments
- lint errors
- lint
- change dense metric L2 -> COSINE
- agent_rag now checks for graph ontology
- lint

### Refactor

- **multi-agents**: consolidate agent registry with convention-based configuration

## 0.1.18 (2025-10-06)

### Fix

- **rag**: build on all tags

## 0.1.17 (2025-10-06)

## 0.1.16 (2025-10-04)

### BREAKING CHANGE

- none
Closes: #324

### Feat

- **agents**: enhance jira agent and add argocd tests
- **agents**: enhance jira agent and add argocd tests
- add connectors
- add common utils
- unified rag server
- migrate ontology and rag agent
- **deepagents**: add deepagents package locally
- **backstage**: add TechDocs tools for improved documentation access
- disable graphrag in helm chart until fixed
- add tags to helm dependencies
- current experiment-dev-use2-1 values

### Fix

- resolve RAG agent connection issues
- lint
- agent_rag is now like all other agents
- **docker-compose**: remove dev volume mount
- updates
- docker-compose; integrate rag with supervisor attempt
- updates
- **agent-rag**: update uv.lock
- **rag**: update docker compose and bring back clients
- optipnal disable graph-rag; prompt tweaks; raw_query tweaks
- rag-query-test
- agent_rag prompts lint
- Makefile
- gh-workflow, linting, small bugs
- remove deprecated kb_rag
- remove deprecated graph_rag
- fix dockerfiles and docker compose
- remove redundant client and pytest files
- remove more redundant license, changelog etc.
- remove redundant license, changelog etc.
- add package-lock.json for webui
- un-ignore package-lock.json
- add pywright to gitignore
- **format**: deep agents ruff fixes
- **format**: add ruff linting fixes
- **streaming**: remove response format from system prompt
- **streaming**: enable structured output
- **merge**: fix conflicts
- **merge**: fix conflicts
- **backstage**: update lockfile after adding pyyaml dependency
- **idpbuilder**: update docs
- actually bump main chart version
- remove a2a-stable tag reference;
- for now always set is_task_complete as True in order to avoid Queue is closed err
- **kb-rag-agent**: prevent ExternalSecret creation when data is empty
- **idpbuilder**: update paths
- use helm dependency imports
- add note on why slim is a condition
- slim will have to be a condition
- disable all tags by default
- remove all condition
- no condition path by default
- updates
- Remove undefined imports from evals __init__.py
- remove test_extractor.py error file
- pin kb-rag services to sha-b098b8d
- fix workshop4 to specific version

### Refactor

- improve RAG agent configuration and testing
- **argocd**: modernize string formatting in server.py

## 0.1.15 (2025-09-19)

### Fix

- **ci**: A2A/MCP builds

## 0.1.14 (2025-09-19)

### BREAKING CHANGE

- helm chart version bumped to 0.2.3

### Feat

- **auth**: update A2A authentication configuration
- add additional authentication options for A2A protocol
- add missing agent deployments for aws, splunk, webex, komodor

### Fix

- **ci**: A2A/MCP build and publish on main/tags
- **ci**: A2A/MCP build and publish on main/tags
- **ci**: A2A/MCP build and publish on main/tags
- **A2A_AUTH_SHARED_KEY**: set default to false
- CHANGESET.md
- lint
- updates
- correct commit count for prebuild GHAs

## 0.1.13 (2025-09-18)

### Feat

- upgrade Jira agent to API v3

### Fix

- undo helm values.yaml

## 0.1.12 (2025-09-17)

### BREAKING CHANGE

- test command now runs both general and RAG module tests
- Redis service port name changed from 'http' to 'redis'

### Feat

- idpbuilder values
- add OAuth2 authentication support for A2A protocol
- add integration test workflows and improve agent Docker build automation
- updating collection name from rag-default to rag-united
- backend data management improvements for milvus and redis
- adding addtional config in web UI frontend
- add prebuild docker image github actions
- Only build images if relevant change
- Adding streamable http to Webex agent
- Adding initial, optional Webex agent
- Adding streamable http to Webex agent
- Adding initial, optional Webex agent
- use routing evaluator and tool match evalutor and use the expected ouptut in the dataset
- implement new llm-trajectory match evaluator
- redesign the trajectory and tool call match evaluator
- **trace**: redesign trace processing method to get the tool call
- **evals**: refactor evaluator architecture and switch to OpenAI
- **evals**: add unified trajectory evaluator with graceful LLM fallback
- **evals**: link dataset traces with platform engineer execution
- **evals**: add auto-detection for Langfuse host in upload script
- add expected_output support and separate upload functionality
- add eval service
- major helm chart refactor
- implement memory-optimized batch processing for URL loading
- update agents documentation and sidebar
- enhance coverage reporting with detailed metrics and tables
- **tests**: add comprehensive test suite with memory monitoring and scale tests
- add AWS agent to include cost explorer MCP (#251)
- add kb-rag-web to helm chart
- add the aws agent to platform engineer (#246)
- Addition of Agent Splunk (#247)
- use a2a card to dynamically create client
- added redis db management backend
- added reranking
- frontend now supports RAG config
- add multiple llm provider support for graphrag

### Fix

- updates
- adding generic to custom parser to scrap sites like wikipedia
- updating docker compose for the workshop
- **gha**: update for tags
- gha litellm typo fix
- **mcp-docker-build**: add webex mcp
- update sidebars.ts
- updated loader.py
- updated rag_api
- dividing rag_api for added flexibility and readiness
- adding init file
- changed variable name from UNIFLIED_COLLECTION_NAME TO DEFAULT_COLLECTION_NAME
- renaming: rag_united --> rag_default
- docker compose
- **graph-rag**: lint
- **graph-rag**: heuristics improvements, use graph db to store relation candidates
- correct mcp image builds - use OR not AND
- improve the prebuild github actions
- add litellm to mcp as well
- fixed conflicts between main
- also modify supervisor agent
- AND not OR
- lint
- fix slim to work
- Add queue closed error protection to prevent crashes during shutdown
- unit tests and quick sanity
- ruff linter
- minor formatting in splunk
- added webex to platform engineer
- adding logs to webex mcp
- adding webex to workflows
- updating docker compose
- adding init files to webex client
- **docker-compose.dev**: add p2p-tracing profile to nexigraph
- no default env in kb-rag-server chart
- **evals**: resolve linting issues and remove hardcoded local paths
- **evals**: update evaluation datasets with correct agent names and enable tests
- **evals**: remove unnecessary .python-version and fix Dockerfile
- **evals**: improve A2A client integration and add Azure OpenAI support
- remove relative import
- update docker-compose networking and ports for p2p-tracing
- resolve Docker compose issues for evaluation webhook
- update weather agent dependencies and Docker configuration
- kb-agent-rag requires milvus secret
- smaller milvus res
- remove excessive resource requests
- remove node selector and limit eph storage
- further cleanup
- remove unsued env
- bring latest milvus vals and template milvus uri
- try more delay
- revert wrong change
- default llmSecrets in kb-rag-server
- correct liveness and readiness port for kb-rag-agent
- kb-rag-server also requires llm secret
- copy working milvus values
- move milvus to the parent chart
- milvus is INSIDE kb-rag-stack...
- remove deprecated isMultiAgent
- correct appVersion
- properly fix kb-rag-agent secrets
- modify kb-rag-stack for the same change
- resolve unit test failures and improve memory optimization
- mcp_splunk symlink to be in-repo relative
- **rag**: restructure package to use rag.server.* namespace
- **docker**: update Dockerfile for new package structure
- **rag**: update coverage configuration for new package structure
- **helm**: bump chart version to 0.1.18
- **rag**: restructure KB-RAG package with proper scoping
- **ci**: resolve KB-RAG Stack Helm chart test failures
- **ci**: resolve Helm chart test failures in GitHub Actions
- **docs**: resolve broken links causing Docusaurus build failures
- **ci**: add proper download links for coverage artifacts
- correct XML attribute access for coverage parsing
- handle missing main coverage and improve coverage reporting
- update remaining uv.lock files and add coverage debugging
- update uv.lock files to resolve Docker build issues
- add debugging and error handling for coverage XML parsing
- update uv.lock files to resolve Docker build issues
- remove stray 'p' character causing JavaScript ReferenceError
- add --index-strategy unsafe-best-match for PyTorch CPU installation
- use --extra-index-url instead of --index-url for PyTorch CPU installation
- update a2a-sdk dependency format and workspace configuration
- resolve a2a-sdk dependency issue in CI
- install CPU-only PyTorch in RAG tests to avoid NVIDIA packages
- Pin all a2a-sdk versions to 0.2.16
- Add missing fs import in GitHub Actions workflow
- Resolve Docker build workspace member issues
- Exclude RAG module tests from main test suite
- Remove Poetry dependencies and migrate RAG module to UV
- unit tests and linting
- lint
- **rag**: replace incorrect ascrape method with proper LangChain async methods
- optimize memory usage by streaming page processing (#253)
- **kb-rag-redis**: correct service port configuration to match deployment (#252)
- add milvus to parent chart
- updates
- updates
- update kb-rag-server
- update kb-rag-server
- **kb-rag-agent**: restore
- **kb-rag-stack**: add condition: agent.enabled
- remove kb-rag-agent dedicated chart
- updates
- just add a new subchart for now
- default no SA
- **aws**: ruff lint
- broken links
- updates
- remove debug line
- **aws-agent**: ruff lint
- fixed readme and created agent container
- add try/except when agent is unreachable
- docker compose dev
- docker compose dev
- docker compose dev
- docker compose dev
- add misc utils - run coroutine in sync
- cleanup how we do agent enabled
- ruff lint
- **graph-rag**: qa agent now fetches properties before raw query
- created was being updated regardless
- ruff linter
- clean kb-rag workflow to reduce space usage
- ruff linter
- ruff linter
- added dockerignore
- updated docker compose
- update uv lock
- include in pyproject
- get rid of non existing func
- much simpler fix :)()(
- ruff linter
- **workshop**: mission4: rag-agent docker port -> 8020
- **workshop**: mission4: rag-agent docker port -> 8020
- **workshop**: mission4: switch to main tag for github agent
- **workshop**: mission7
- **workshop**: mission7
- **github**: add load_dotenv
- updates sidebars.ts for docs
- png to svg
- png to svg
- **workshop**: mission4: add restart policy to docker compose
- updating port number for kb-rag
- typo for logger message
- **workshop**: switch mission4 to a different env file
- **weather**: add self.mcp_api_key

### Refactor

- **evals**: improve eval run naming with readable timestamp format
- **evals**: clean up directory structure and remove obsolete files
- remove hardcoded agent detection and use dynamic regex patterns
- create kb-rag-stack

## 0.1.10 (2025-08-26)

### Fix

- **petstore**: add PETSTORE_API_KEY support
- correct petstore mcp env var name
- Update README.md (#230)

## 0.1.9 (2025-08-26)

### Fix

- **github**: add ENABLE_MCP_TOOL_MATCH feature flag (#229)
- ruff lint
- rag ingestion crash; workshop docker file

## 0.1.8 (2025-08-25)

### Feat

- **argocd**: add argocd sanity tests for local argocd kind instance (#224)

### Fix

- **petstore/weather**: bug fixes (#225)
- **docs**: escape  in Jira MCP comparison table for MDX compatibility
- update navigation

## 0.1.7 (2025-08-25)

### Feat

- **workshop**: add workshop 7 docker-compose
- add http mcp remote support for petstore and weather agents
- implement job tracking and ingestion progress for URL processing
- initialize frontend for KB RAG with React, Vite, and Tailwind CSS
- create dev mission docker file
- add petstore to docker-compose.weather
- add multi-agent dynamic connectivity and petstore refactor
- add weather agent with stdio mcp server
- adding rag-ingestion pipeline
- **brand**: update docs to CAIPE branding (#211)
- add eval prompts (#191)
- **docker**: use multi-stage builds to reduce container size (#198)
- add a new graphrag helm chart

### Fix

- docker-compose.mission2.yaml
- **weather**: use remove URL (#223)
- **workshop**: remove langfuse components from mission 7
- **workshop**: add network host to langfuse web
- **workshop**: remove rag from mission 7
- **workshop**: remove profiles from docker compose 7
- **docs**: update solution architecture
- **docs**: update solution architecture
- **docs**: update solution architecture
- add docker build for kb-rag ui
- add mission docker-compose, add prgress message for chunked doc
- **README.md**: add start history (#217)
- lint errors and argocd mcp bugs (#218)
- ruff lint
- **argocd**: test and validate mcp after auto-generation changes (#215)
- update reference/source when outputting answer
- default top_k for query 10 -> 3, better log
- add empty document fields instead of omitting
- kb-rag-agent image
- add weather for a2a build gh action
- lint
- petstore agent and refactors
- Dockerfile, add page counter
- **argocd**: add VERIFY_SSL and ARGOCD_VERIFY_SSL support in mcp (#209)
- removing knowledge base from .dockerignore
- **argocd.md**: update kubectl context
- **kb**: add init file to make it a package
- **kb**: add init file to make it a package
- **common.mk**: make run-mcp
- adding init files
- platform engineering workflow push to main
- **docker-compose**: remove a2a- prefix (#200)
- docker latest images with uv.lock (#199)
- replace dotenv to python-dotenv
- **uv**: add dotenv
- **uv**: add dotenv
- remove bad file change
- bump all chart v and app v
- mount path
- fix multiagent volume mount and clean up
- no lb
- fix2
- fix"
- neo4j official chart
- redis
- no probe
- similar env fix
- correct var names
- set storage class default to gp2 for now
- wrong secretRef path
- create json file and make graphrag optional
- add SA field

## 0.1.5 (2025-08-15)

### Feat

- fix Langfuse trace ID propagation in multi-agent system (#195)
- **helm**: add useRemoteMcpServer to use remote MCP server (#193)
- add mcp http support to helm chart (#190)

### Fix

- Dockerfile improvements and add .dockerignore (#197)
- fix missing sub helm chart bump
- mcp dockerfile to give .venv permissions (#192)

## 0.1.4 (2025-08-12)

### Fix

- **build**: update workflow triggers
- **build**: remove a2a prefix for agent container images
- **build**: build and publish agents on every push to main and tags

## 0.1.3 (2025-08-12)

### Feat

- add slim to helm chart (#187)
- use agntcy-app-sdk to integrate with agntcy slim (#171)
- **graph-rag**: add evaluation and tests
- embed vidcast in idpbuilder doc
- add a new pre-release helm chart github action
- output URL to help user.
- updated kb-rag from agent-rag
- implement distributed tracing across all agents (#139)
- add idpbuilder docs (#142)
- allow external url as the A2A url (#122)
- intial commit incident engineer (#111)
- **graph_rag**: create nexigraph graph rag system (#97)
- **rag**: doc load, embed, vector store, retrieve (#96)
- updates
- updates
- remove dependency.yml
- updates
- update OSS artifacts and github actions
- add some colours to the docs code block
- add doc for eks deployment
- **helm**: add command and args to deployment
- **helm**: publish chart
- add CORS and use LLMFactory
- use cnoe_agent_utlis
- publish helm
- added ci pipeline
- added ci pipeline
- added A2A server and re-formatted
- add A2A integration and new MCP server (#5)
- Use cnoe utlis to get rid of llm_factory to encompass latest LLMs
- added google's A2A server and client side
- short term memory to the agent
- add helm publish
- add CORS and fix lint errors
- use cnoe_agent_utlis instead of llm_factory
- add agent forge
- **agent-komodor**: add komodor agent
- add script to automate Helm configuration for new agents
- **docs**: add docs website
- implement dual-mode docker-compose and update the readme and example env
- **tracing**: use env to enable tracing
- monkey patch a2a noise
- implement langfuse v3
- publish helm
- added ci pipeline
- added ci pipeline
- added A2A server and re-formatted
- add A2A integration and new MCP server (#5)
- adding confluence agent
- publish helm
- added ci pipeline
- added ci pipeline
- added A2A server and re-formatted
- add A2A integration and new MCP server (#5)
- add agent-a2a-docker-build.yml
- add mcp server support (#45)
- **helm**: Implement helm chart (#42)
- propogate context_id from user client LangGraph thread_id (#34)
- **Dockerfile**: add multi-arch support
- **cors**: add CORS and update ACP/A2A graph entry point (#11)
- add A2A integration and new MCP server (#5)
- adding 6th agent backstage
- allow custom prompts via YAML config and restore original agent/platform prompt defaults

### Fix

- **build**: add latest tag for agent builds
- add kb-rag to Platform Registry
- readding new clients to kb-rag
- updated-docker compose
- format in agent a2a docker builder
- **a2a-docker**: publish on main and tags
- mcp docker improvements (#186)
- quick sanity tests and docker-compose files (#185)
- **quick-sanity**: add komodor variables
- **quick-sanity**: clean-up workspace
- **quick-sanity**: update variables
- **quick-sanity**: update runner name
- **quick-sanity**: use caipe-integration-test-runner
- **mcp**: use mcp-xxx container names
- **ipdbuilder**: update idpbuild docs (#182)
- linting, add eval results for graph-rag
- **graph-rag**: give similar relations when evluating
- **README.md**: add note to latest docs
- docs images need to be svg not png
- update chunk number
- using the right azure embeddings
- updating prompts
- ruff linter
- loaded kb-rag into caipe's environment
- another version number
- updated a2a version
- surpress milvus logs
- github workflows
- renamed kb-rag to rag to fix import errors
- updated kb_rag
- fixed breaking change
- updated docker-build
- added kb-rag
- updated docker builder
- updated docker build
- **docs**: update tracing docs
- add profiles to graph_rag/nexigraph services
- remove a2a from nexigraph images
- add ghcr.io prefix to images
- nexigraph client path
- nexigraph build path
- docker-compose graphrag image
- **docs**: nexigraph agent names
- helm correct externalSecret templating
- agent-jira and agent-confluence (#133)
- ruff lint
- **graph-rag**: adding tests for heuristics; better heuristics; more accurate evalaution
- helm chart agent-forge needs http for healthcheck
- always pull and expose external url
- **lint**: errors
- **supervisor_agent**: system prompt optimization and use agent tools (#117)
- **atlassian**: remove agent-atlassian (#116)
- add tools, utils and meeting recordings
- **docs**: ics file path
- **docs**: ics file path
- **docs**: ics file path
- **README.md**: update arch diagram
- ruff linter fails (#102)
- allow multiple ports for agents
- **tracing**: enable tracing in local build docker-compose
- remove GOOGLE_API_KEY dependency
- **docker-compose**: restore
- import error
- **prompts**: update backstage import
- **docker-compose**: create multiple profiles build, latest (#98)
- **a2a-docker**: update triggers
- **clean-up**: remove helm charts
- remove .DS_Store
- reconcile updates
- migrate agent-pagerduty
- ruff linter
- updated line length ruff linter
- deleted tests
- updated mcp server to reflect correct imports
- updated imports
- docker action build
- cleanup of agent-template
- updated dependencies
- updates
- **Makefile**: clean-up targets
- updates to code
- reconcile PR comments
- add ai_platform_engineering/agents/argocd/build/Dockerfile.mcp
- **lint**: reconcile
- **ci**: run A2A parallel build on PR push
- **langgraph**: updates
- **clean-up**: remove redundant files
- **ci**: build all agent docker images
- updates
- updates
- add Dockerfile.a2a
- **agents**: update Dockerfile.a2a file and clean-up
- update build/Dockerfile.a2a
- **docs**: authors.yml
- **docs**: broken link
- correct sidebar order
- helm deployment rendering fix
- update app and chart versions to 0.1.3 and adjust secret reference logic in deployment.yaml
- correct conditional logic for secret reference in deployment.yaml
- update app and chart versions to 0.1.2 and adjust values for backstage plugin
- lint errors in add-new-agent-helm-chart.py
- agent-forge should be port 3000
- bump helm chart patch version
- updated stable tag
- mcp server api/catalog fixes
- remove .keep files
- **Dockerfile**: use python:3.13-slim
- client side context_id
- server side context_id
- ruff lint changes
- async error fixed.
- lint errors
- lint github actions
- **Dockerfile**: use python:3.13-slim
- updates
- updates
- client side context_id
- server side context_id
- remove AzureChatOpenAI in agent
- remove AzureChatOpenAI in agent
- **jira**: update search results
- lint errors
- add CORS support
- add ruff in ci pipeline
- ci errors
- remove acp docker build
- remove GOOGLE_API_KEY
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- **Dockerfile**: use python:3.13-slim
- **helm**: publish helm chart
- server side context_id
- client_slide_context_id
- add CORS support
- ruff pipeline
- ci errors
- ci updates
- remove GOOGLE_API_KEY
- **acp**: update agent.json
- **acp**: update agent.json
- updated .gtihub
- added dockerfile.a2a and acp
- path changed for docker acp and a2a
- update a2a and acp docker
- updated docker files in .github
- remove invalid async context usage with MultiServerMCPClient
- technical issue with data retrieval
- pagerduty token and logs
- **docs**: updates
- **README.md**: updates
- **README.md**: updates
- **README.md**: updates
- **README.md**: updates
- **README.md**: updates
- **docs**: update README.md
- **Dockefile**: use python:3.13-slim
- **helm**: change default service port to 8000
- **helm**: rename chart to agent-github
- ruff linter
- use LLMFactory and lint errors
- remove acp docker build
- ruff lint
- client side context_id
- server side context_id
- **docs**: add some under construction anchors
- **docs**: add github issues
- **docs**: broken link
- **docs**: update usecases
- **.env.example**: remove it to fix linter
- helm gh wf with correct paths
- helm chart push on merge
- **docs**: updates
- Update user-interfaces.md
- broken links
- **komodor-agent**: only deploy komodor agent if use docker compose override
- **komodor-agent**: use llm factory instead of langchain library
- update python script name
- reconcile
- **docs**: README.md
- **docs**: updates
- **docs**: updates
- **docs**: updates
- **docs**: update sidebars.ts
- **docs**: add blog and simplify
- updates
- editUrl link
- **docs**: update edit links
- **docs**: github action publishing update baseUrl
- **docs**: github action publishing
- **docs**: github action publishing
- **docs**: github action publishing
- add langfuse reference
- updates
- merge updates
- add missing import os
- updates
- updates
- client side context_id
- server side context_id
- remove AzureChatOpenAI in agent
- remove AzureChatOpenAI in agent
- **jira**: update search results
- lint errors
- add CORS support
- add ruff in ci pipeline
- ci errors
- remove acp docker build
- remove GOOGLE_API_KEY
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- docker container build
- fixed agent tools
- updates
- updates
- client side context_id
- server side context_id
- remove AzureChatOpenAI in agent
- remove AzureChatOpenAI in agent
- **jira**: update search results
- lint errors
- add CORS support
- add ruff in ci pipeline
- ci errors
- remove acp docker build
- remove GOOGLE_API_KEY
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- helm chart workflow improvements
- correctly add global secretName
- **argocd**: update poetry.lock
- **multi_agents**: rename mas->multi_agents
- github actions workflows
- **gha**: typo
- **poetry**: updates
- build docker errors
- update test dependencies
- unit tests
- lint
- import errors
- **query-params**: Don't add query param to request if None (#44)
- **Dockerfile**: use python:3.13-slim
- **api**: support nested body parameters and fix boolean types
- **helm**: default service port 8000
- **helm**: version 0.1.1
- **helm**: Update image.tag in values.yaml
- **helm**: updates
- **helm**: updates
- **helm**: updates
- **helm**: only trigger on tags
- **test**: lint errors
- **helm**: update gh workflow
- **helm**: update gh workflow
- **README.md**: update local dev tasks
- temporarily remove api_v1_applications_manifestsWithFiles
- update mcp_server bindings (#33)
- **README.md**: updates
- **README.md**: update architecture diagram
- add MCP_VERIFY_SSL for local development and update README (#32)
- rename to A2A_HOST and A2A_PORT (#31)
- **acp**: docker image
- updates to A2A client (#22)
- update to use argocd
- updates with AGENT_NAME
- **MAINTAINERS.md**: updates
- **README.md**: status badgese
- update README.md
- **README.md**: demos
- **README.md**: project structure
- **README.md**: update badges
- **agent.json**: update to conform to new specification (#12)
- **README.md**: update mcp server link
- import error for a2a and python3 (#9)
- **protocols**: add a2a-sdk and update makefile (#10)
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- updates
- updates
- prompt_config.yaml
- add prompt_config_example.yaml
- minor fixes
- updates
- **Makefile**: update run-ai-platform-engineer and set run as default target
- **docker-compose**: comment out agentconnect by default
- add incident_engineer placeholder
- **env**: use .env instead of .env.foo per agent
- **docker-compose**: restore agentconnect ui
- add CORS and update system prompt
- **a2a**: update docker-compose bring up
- **Makefile**: add setup-venv
- update the default AGENT_PORT 8000
- updates
- unittest, lint and container name
- updates
- **Dockerfile**: update ci
- updates

### Refactor

- prompt config to use structure output. Use UV, langgraph==0.5.3, a2a-sdk==0.2.16 (#155)
- **docs**: simplify the top level menu (#110)
- **agent-atlassian**: remove and update that it is split into Jira and Confluence agents (#103)
- **multi_agents**: move build directory
- update Makefile, Dockerfiles, and clients for LangGraph agent deployment
- with latest changes
- create protocol_bindings directory for acp/a2a/mcp
- updated a2a, acp, mcp and docker addition
- updated previous acp and standardized new format.
- with latest changes
- create protocol_bindings directory for acp/a2a/mcp
- with latest changes
- create protocol_bindings directory for acp/a2a/mcp
- **external-secrets**: improve secret name handling and update configuration examples
- **monorepo**: rename mas->multi_agents, use seperate mcp python project
- **agent-argocd**: collapse to ai-platform-engineering
- clean-up old code and update docs (#38)
- docker support, clean-up, new chat client interface (#13)
- create protocol_bindings directory for acp/a2a/mcp
- optimize system prompt from a2a cards and skills
