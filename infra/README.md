# Infra — Day 1 Bring-Up

Self-hosted SDLC agent pipeline: **React UI → Express backend → n8n → Dify → Azure AI Foundry / Kimi**.

See the approved plan at `~/.claude/plans/so-but-flow-you-wise-parnas.md` for the full design.

## Layout

```
infra/
├── README.md                          (this file)
├── n8n/
│   └── docker-compose.yml             n8n orchestrator
├── dify/                              (cloned on Day 1 — see below)
└── sql/
    ├── 000_init_databases.sh          creates the `n8n` database on first Postgres boot
    ├── 001_agent_repo_registry.sql    multi-repo registry
    └── 002_pipeline_runs.sql          run-status tables + NOTIFY trigger
```

## Bring-up order

### 1. Create the shared Docker network (one-time)

```sh
docker network create agentic-net
```

### 2. Bring up the app stack (frontend, backend, postgres)

```sh
docker compose up -d --build
```

This will:
- attach all services to `agentic-net`
- run `000_init_databases.sh` on first Postgres boot, creating the `n8n` database

### 3. Apply SQL migrations to the `agentic` database

```sh
docker compose exec -T postgres psql -U postgres -d agentic < infra/sql/001_agent_repo_registry.sql
docker compose exec -T postgres psql -U postgres -d agentic < infra/sql/002_pipeline_runs.sql
```

### 4. Bring up n8n

```sh
# generate an encryption key once and put it in a .env next to the compose file
export N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose -f infra/n8n/docker-compose.yml up -d
```

Visit http://localhost:5678 and complete the owner-account setup wizard.

### 5. Clone and bring up Dify

```sh
cd infra/dify
git clone https://github.com/langgenius/dify.git .
cd docker
cp .env.example .env
# Edit docker-compose.yaml:
#   - change nginx port from 80:80 to 8080:80
#   - add `networks: { default: { external: true, name: agentic-net } }` to every service
docker compose up -d
```

Visit http://localhost:8080 and complete Dify's admin setup.

## Required external accounts (Day 1 prerequisites)

These can't be created from this repo — you'll need to set them up in their respective consoles:

| Service | What to create | Used by |
|---|---|---|
| Azure AI Foundry | Serverless endpoints for Llama-3.3-70B-Instruct, Llama-3.1-405B-Instruct, Mistral-Large-2411, Phi-4 | Dify model provider "Azure AI Studio" — stages 1–5 |
| Moonshot Platform | API key from `platform.moonshot.ai` (or deploy Kimi on Azure ML in production) | Dify custom OpenAI-compatible provider — stages 6 (Kimi-K2) and 7 (Kimi-Dev-72B) |
| GitHub App | New App in your org, install on pilot repos, store private key | n8n GitHub credential — multi-repo access |
| Azure AD App | App registration with `Sites.Read.All`, `Files.ReadWrite.All` (application permissions) | n8n Microsoft OAuth2 credential — SharePoint docs |
| Slack app (optional) | Bot token + Interactivity URL via cloudflared tunnel | n8n Slack credential — off-app approvals |

## Verifying Day 1 is done

```sh
docker compose ps                          # frontend, backend, postgres healthy
docker compose -f infra/n8n/docker-compose.yml ps   # n8n healthy
docker compose -f infra/dify/docker/docker-compose.yaml ps   # all dify services healthy

# Schema check
docker compose exec -T postgres psql -U postgres -d agentic -c '\dt'
# expect: agent_repo_registry, pipeline_runs, pipeline_stage_status
```

## Port map

| Port | Service |
|---|---|
| 3001 | React frontend |
| 5000 | Express backend |
| 5432 | Postgres |
| 5678 | n8n |
| 8080 | Dify nginx |
