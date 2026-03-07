# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LexGent Demo is the **application layer** for the LexGent Agent framework. It provides infrastructure services (Data Server, YAML Server), a CLI client, and all YAML-based agent configurations.

This repo is the open demo half of the LexGent project. The companion repo `lexgent-engine` is the private core engine.

## Common Commands

```bash
# Install dependencies
npm install

# Start Data Server (port 3000)
npm run start:data

# Start YAML Server (port 3003)
npm run start:yaml

# Start Client (interactive mode, auto-starts Data/YAML servers if needed)
./scripts/run_client.sh

# Start all demo servers
./scripts/start_all.sh

# Client with arguments
npx ts-node src/client/index.ts -i          # Interactive mode
npx ts-node src/client/index.ts -ts s01     # Run specific skill
npx ts-node src/client/index.ts -l          # List skills
```

## Architecture

### Microservices Model

```
Client (this repo) <-> Agent Engine (lexgent-engine, :3001) <-> Data Server (this repo, :3000)
                                                             <-> YAML Server (this repo, :3003)
```

### Source Structure

```
src/
├── data_server/        # File-based case data persistence (port 3000)
├── yaml_server/        # Serves YAML configs as REST API (port 3003)
├── client/             # CLI client with SSE streaming
└── shared/             # Shared config, types, utilities

data/
├── yaml/               # All agent configurations
│   ├── framework/      # System prompt template
│   ├── law_agent/      # Law agent configs
│   │   ├── agent.yaml          # Agent manifest (model, skills list)
│   │   ├── configs/dev.yaml    # Runtime config (LLM providers, data server URL)
│   │   ├── skills/             # Skill definitions (s_*.yaml)
│   │   ├── prompts/            # Handlebars templates (p_*.hbs)
│   │   ├── functions/          # Function definitions + JS workers
│   │   ├── tasks/              # Task definitions (t_*.yaml)
│   │   └── types.yaml          # Document type registry
│   └── test_agent/     # Test agent for framework validation
├── case-data/          # Sample case files (case-101, case-102, case-103)

scripts/
├── run_client.sh       # Start client (checks engine, auto-starts demo servers)
├── run_data_server.sh  # Start data server
├── run_yaml_server.sh  # Start YAML server
└── start_all.sh        # Start all demo servers
```

### Key Components

- **YAML Server** (`src/yaml_server/handler.ts`): Loads all YAML configs into memory cache on startup, serves via REST API. Supports Chinese characters in URLs (decodeURIComponent).
- **Data Server** (`src/data_server/handler.ts`): File-based storage for case documents, context, and generated outputs.
- **Client** (`src/client/index.ts`): CLI interface with SSE event streaming from engine.

### YAML Server API Routes

```
GET  /agents                           - List all agents
GET  /agents/:agentId                  - Agent manifest
GET  /agents/:agentId/skills/:id       - Skill config (by ID or filename)
GET  /agents/:agentId/prompts/:name    - Prompt template (.hbs content)
GET  /agents/:agentId/functions/:id    - Function config
GET  /agents/:agentId/tasks/:id        - Task config
GET  /agents/:agentId/types            - Document types (from types.yaml)
GET  /agents/:agentId/configs/:id      - Runtime config
GET  /agents/:agentId/dir/:subdir      - Directory listing (with ?pattern= glob)
GET  /agents/:agentId/source/:name     - JS source for code functions
```

## Key Conventions

- **Path aliasing**: Use `@/*` for imports from `src/*`
- **Explicit extensions**: All YAML config references include extensions (`.yaml`, `.hbs`)
- **Agent configs**: `agent.yaml` lists skills/functions/tasks with glob patterns (e.g., `law_agent/skills/s*.yaml`)
- **YAML Server indexing**: Resources indexed by both ID (e.g., `Skill_当事人提取`) and filename (e.g., `s_当事人提取`)
- **Runtime workspace**: `.runs/` for server logs (gitignored)

## Environment Setup

Required `.env` (see `.env.example`):
```ini
DATA_SERVER_PORT=3000
YAML_SERVER_PORT=3003
AGENT_SERVER_URL=http://localhost:3001
```

## Adding New Skills

1. Create skill YAML in `data/yaml/{agent}/skills/s_{name}.yaml`
2. Create prompt template in `data/yaml/{agent}/prompts/p_{name}.hbs`
3. Restart YAML Server to reload cache (or restart client via `run_client.sh`)

## Development Notes

- `run_client.sh` checks engine first (exits if not running), then auto-starts Data/YAML servers if needed. Background servers are cleaned up on script exit.
- YAML Server caches everything in memory at startup. Must restart to pick up config file changes.
- `types.yaml` is a single file (not a directory), loaded directly by YAML Server.
