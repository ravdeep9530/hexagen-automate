# Plan: Self-Hosted SDLC Agent Pipeline (n8n + Dify)

## Context

You want an AI-agent pipeline that runs a 7-stage SDLC flow — **Requirements → Optimize → Plan → Design → Sprint Planning → Implementation → Test** — across multiple GitHub repos, **triggered and monitored from your existing React frontend** at [frontend/](/Users/ravdeepsingh/agentic-platform-local/frontend/). You already have the platform scaffolded at [agentic-platform-local/](/Users/ravdeepsingh/agentic-platform-local/) (Node/Express backend + React frontend + Postgres). Tools must be open-source, self-hosted on Docker (PoC), with **human approval at every stage**, **per-step visibility** in the app UI, and **Azure-hosted open-source models** (Llama / Mistral / Phi via Azure AI Foundry) instead of Anthropic direct.

**Decision**: Layered stack — **n8n** as orchestrator/integrations layer + **Dify** as the agent control plane (prompts, RAG, model selection, run observation). Your existing Express backend becomes a thin **pipeline API** that the React UI talks to; it forwards run requests to n8n and streams per-stage status back. Dify is configured to use **Azure AI Foundry** as its model provider so all inference hits Azure-hosted open-weights models.

Why not single-tool: Dify alone is weak on external system orchestration; n8n alone is weak on agent memory/RAG and prompt versioning. Why not CrewAI/MetaGPT: those are code-first — they don't give your team a UI to edit agent behavior.

## Architecture

```
                       ┌──────────────────────────────────────┐
React UI (3001) ──▶ Express backend (5000) ──▶ n8n (5678) ──▶ Dify (8080) ──▶ Azure AI Foundry
     ▲   ▲                  │     │                │             │
     │   │ SSE/WS           │     │ pg writes      │ webhooks    │ Llama/Mistral/Phi
     │   └──────────────────┘     ▼                ▼
     │                       run_status table   per-repo RAG KB
     │
GitHub webhook ──▶ n8n ──▶ Slack/Teams (Approve/Reject) ──▶ resumes n8n Wait
                    │
                    ├──▶ SharePoint (MS Graph)
                    ├──▶ Postgres (registry + run_status)
                    └──▶ GitHub App (multi-repo PRs)
```

Three entry points trigger pipelines: (1) the React UI (manual kickoff), (2) GitHub webhooks (push/PR), (3) GitHub Projects card moves. All converge on the same n8n parent pipeline. The backend `run_status` table is the single source of truth the UI polls/streams from.

Three independent docker-compose projects on a shared Docker network:
- **Existing** `/Users/ravdeepsingh/agentic-platform-local/docker-compose.yml` (frontend 3001, backend 5000, postgres 5432)
- **New** `infra/n8n/docker-compose.yml` (n8n on 5678)
- **New** `infra/dify/docker/docker-compose.yaml` — cloned from `langgenius/dify`, nginx remapped to 8080

```
docker network create agentic-net
```
All three composes attach to `agentic-net` as an external network; services resolve each other by name. **Do not merge** Dify's ~8 services into your compose — its migrations clash with shared Postgres.

**Final port map**: 3001 frontend · 5000 backend · 5432 postgres · 5678 n8n · 8080 Dify

## Per-Stage Agents (in Dify)

Each is a separate Dify app with its own API key. n8n calls them via `POST http://nginx/v1/workflows/run` (workflow type) or `/v1/chat-messages` (chatflow type) with `Authorization: Bearer <key>`.

All inference goes through **Azure AI Foundry / Azure OpenAI** in the user's `CareChain Cloud` tenant. Three models cover the 7 stages cleanly:

- **GPT-4.1** (Azure OpenAI Service, `carechain-open-ai-ce-dev`) — Dify provider: `langgenius/azure_openai/azure_openai`. Conversational + structured stages.
- **Kimi-K2.6** (Foundry MaaS, `carechainaistu3962432517`) — Dify provider: `langgenius/azure_ai_studio/azure_ai_studio`. Thinking variant, returns `reasoning_content` separately. Coding stages.
- **DeepSeek-R1** (same Foundry MaaS resource) — same Dify provider as Kimi. Inline `<think>...</think>` reasoning. Deep-reasoning stages.

| # | Stage | Dify type | Model | KB | Approval artifact |
|---|---|---|---|---|---|
| 1 | Requirements intake | Chatflow | **GPT-4.1** | `requirements-history` | SharePoint draft + GH Projects card (Intake) |
| 2 | Optimize | Workflow | **GPT-4.1** | Requirements + prior designs | SharePoint diff doc (Refined) |
| 3 | Plan | Agent | **DeepSeek-R1** (reasoning) | Per-repo code KBs + design history | SharePoint plan doc + GH milestone |
| 4 | Design | Agent | **DeepSeek-R1** (reasoning) | Affected repos + ADRs | SharePoint design doc (Mermaid embedded) |
| 5 | Sprint planning | Workflow | **GPT-4.1** | Per-repo + ticket-sizing history | GH Projects board with draft issues |
| 6 | Implementation | Agent (fan-out per ticket) | **Kimi-K2.6** (code + tool use) | Target repo only | **GitHub PR (draft→ready); never auto-merge** |
| 7 | Test | Workflow | **Kimi-K2.6** | Target repo + test patterns | CI run + AC coverage matrix posted to PR |

**Key behaviors to wire into Dify app configs**:
- DeepSeek-R1 needs `max_tokens ≥ 4096` (reasoning eats tokens).
- Kimi-K2.6 needs `max_tokens ≥ 1024` and Dify's "reasoning_support" flag is on so the thinking trace is filtered out of the final output.
- GPT-4.1 is straightforward, `max_tokens` 4096 default is fine.

Models are already registered in Dify (verified on 2026-05-15 — all three show `status=active`).

Kimi-K2.6 is **already deployed in Azure AI Foundry** in the user's tenant (no Moonshot dependency, no Azure ML self-host needed). Earlier plan notes about Moonshot API or Azure ML managed endpoint are no longer relevant — superseded by the actual Foundry deployment.

Fallback for any stage: swap to one of the other two registered models from Dify UI without code changes. Future option: register additional models (e.g., GPT-5 once GA'd, Llama-3.x variants) to the same providers — no code changes needed.

Input/output JSON contract between stages — output of stage N is input of stage N+1. Schemas live in Dify's variable definitions per app.

## UI Integration & Per-Step Visibility

Your existing app becomes the **front door + dashboard**. Three pieces:

### 1. Express backend — pipeline API

Add a `pipelines` service module in [backend/src/services](/Users/ravdeepsingh/agentic-platform-local/backend/src/services). Endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/pipelines` | Kick off a run. Body: `{repo, raw_request, requester_id}`. Inserts a `pipeline_runs` row, calls n8n's pipeline webhook with `run_id`. Returns `{run_id}`. |
| `GET` | `/api/pipelines/:run_id` | Snapshot: run + all stage statuses + artifacts. |
| `GET` | `/api/pipelines/:run_id/events` | **SSE stream** — emits a frame on every stage_status change. |
| `POST` | `/api/pipelines/:run_id/stages/:stage/decision` | Approve / Reject from the UI instead of Slack. Backend forwards the decision to n8n's resume webhook (the URL is stored on the row when the Wait starts). |
| `GET` | `/api/repos` | Repos available to run pipelines against (reads `agent_repo_registry`). |

### 2. Postgres run-status tables

```sql
CREATE TABLE pipeline_runs (
  run_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_full_name TEXT REFERENCES agent_repo_registry(repo_full_name),
  raw_request   TEXT,
  requester_id  TEXT,
  status        TEXT,                 -- queued|running|awaiting_approval|approved|rejected|completed|failed
  current_stage TEXT,                 -- requirements|optimize|plan|design|sprint|implementation|test
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pipeline_stage_status (
  id             SERIAL PRIMARY KEY,
  run_id         UUID REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  stage          TEXT,
  status         TEXT,                -- pending|running|awaiting_approval|approved|rejected|failed|skipped
  dify_run_id    TEXT,                -- link back to Dify's run for deep observability
  resume_webhook_url TEXT,            -- n8n Wait-node resume URL, used by UI Approve/Reject
  artifact_url   TEXT,                -- SharePoint doc / PR / GH Projects card
  artifact_json  JSONB,               -- stage output payload (so UI can render diffs)
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  error          TEXT
);

CREATE INDEX ON pipeline_stage_status(run_id, stage);
```

### 3. n8n writes status at every transition

Each stage sub-workflow has 4 **Postgres** nodes wired in:
1. **Before Dify call** → INSERT/UPDATE `pipeline_stage_status` to `running` (also write `started_at`).
2. **After Dify call** → UPDATE with `dify_run_id`, `artifact_url`, `artifact_json`.
3. **Before Wait** → set `status='awaiting_approval'` and store the Wait's `$resumeUrl` in `resume_webhook_url`. This is what the React UI POSTs to when the user clicks Approve.
4. **After IF (approved/rejected)** → set final `status` and `finished_at`. On approve, the parent workflow advances; on reject, parent stops and marks `pipeline_runs.status='rejected'`.

A Postgres `NOTIFY pipeline_event, '<run_id>'` after every UPDATE; the Express backend `LISTEN`s and pushes SSE frames to connected UI clients. No polling.

### 4. React UI — three new screens in `frontend/src/features`

- `features/pipelines/PipelineLaunch.tsx` — repo selector + free-text request box + "Start" button. Calls `POST /api/pipelines`, navigates to detail view with the returned `run_id`.
- `features/pipelines/PipelineDetail.tsx` — 7-stage stepper (Requirements → Test) with live status per stage. Opens SSE connection. Each stage card shows: status badge, started/finished timestamps, artifact link (SharePoint/PR/GH card), expandable JSON output, and an Approve / Reject pair on the `awaiting_approval` stage.
- `features/pipelines/PipelineList.tsx` — history table of all runs, filterable by repo and status.

API client lives in [frontend/src/api](/Users/ravdeepsingh/agentic-platform-local/frontend/src/api) — extend the existing axios instance, add a typed `pipelinesApi`.

UI doubles up with Slack: either approval channel resolves the same `resume_webhook_url`, whichever fires first wins (idempotency-guarded by `pipeline_stage_status.status` check before calling resume).

## n8n Stage-Workflow Pattern (HITL at every stage)

One sub-workflow per stage, identical shape:

1. **Webhook / Execute Workflow Trigger** — entry
2. **Postgres** node — lookup repo in `agent_repo_registry` (gets Dify app IDs, Slack channel, SharePoint drive)
3. **HTTP Request** — POST to Dify `/v1/workflows/run` with stage inputs, `response_mode: blocking`
4. **HTTP Request** — write artifact to SharePoint via MS Graph (`PUT /drives/{id}/root:/path:/content`)
5. **Slack** or **Microsoft Teams** node — post Approve / Reject card; embed `$resumeUrl` from next step
6. **Wait** node — `Resume: On Webhook Call`, timeout 24h; the resume URL is what the button POSTs to
7. **IF** node — `approved === true` → call next-stage sub-workflow via **Execute Workflow**; else → post rejection reason and stop

A parent workflow chains S1 → S7 by calling each sub-workflow. For S6, a **Split In Batches** fan-out runs one Implementation pass per Stage-5 ticket.

## Multi-Repo Registry (Postgres)

Add to your existing `agentic` DB — no new database needed:

```sql
CREATE TABLE agent_repo_registry (
  id SERIAL PRIMARY KEY,
  repo_full_name TEXT UNIQUE,         -- "org/repo"
  default_branch TEXT DEFAULT 'main',
  github_app_install_id BIGINT,
  dify_workflow_app_ids JSONB,        -- {requirements:"...", design:"...", ...}
  dify_kb_id TEXT,
  slack_channel_id TEXT,
  sharepoint_drive_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

n8n's **Postgres** node reads this at the start of every parent workflow run.

## Integrations — recommended auth

- **Azure AI Foundry**: deploy non-coding models (Llama-3.3-70B, Llama-3.1-405B, Mistral-Large, Phi-4) as Foundry **serverless endpoints** in your Azure subscription. Each gets an endpoint URL + API key. Configure Dify provider "Azure AI Studio" with these. Foundry endpoints use key-based auth (not AAD) for inference. Keep keys in n8n credential vault and Dify settings.
- **Kimi (coding stages 6 + 7)**: Option A — Moonshot API key from `platform.moonshot.ai`, added as a custom OpenAI-API-compatible provider in Dify. Option B — Azure ML managed online endpoint with vLLM serving Kimi-K2 / Kimi-Dev-72B weights from HuggingFace; same OpenAI-compatible interface, Azure-resident.
- **GitHub**: GitHub App (org-installed), short-lived installation tokens. Avoid PATs. Works with Projects v2 GraphQL. Store App private key as n8n credential.
- **GitHub Projects v2**: GraphQL via `https://api.github.com/graphql` with the installation token — use n8n **HTTP Request** node (the built-in GitHub node doesn't fully cover Projects v2).
- **SharePoint**: Azure AD app registration with **application** (not delegated) permissions: `Sites.Read.All`, `Files.ReadWrite.All`. n8n's Microsoft SharePoint node is delegated-only — use **HTTP Request** + **Microsoft OAuth2 API** credential with `client_credentials` against `https://graph.microsoft.com/.default`.
- **Slack** or **Teams**: pick one for PoC. Slack is faster to wire (Block Kit + Interactivity URL). Teams uses Adaptive Cards + Bot Framework. n8n has first-class nodes for both. Optional for PoC since the UI itself can handle approvals.

## Critical Files To Create / Modify

**Infra**
- [infra/n8n/docker-compose.yml](/Users/ravdeepsingh/agentic-platform-local/infra/n8n/docker-compose.yml) — n8n service, shared network, Postgres pointer
- [infra/dify/](/Users/ravdeepsingh/agentic-platform-local/infra/dify/) — clone of `langgenius/dify`, with nginx port + network override
- [infra/sql/001_agent_repo_registry.sql](/Users/ravdeepsingh/agentic-platform-local/infra/sql/001_agent_repo_registry.sql) — registry DDL
- [infra/sql/002_pipeline_runs.sql](/Users/ravdeepsingh/agentic-platform-local/infra/sql/002_pipeline_runs.sql) — `pipeline_runs` + `pipeline_stage_status` DDL + `pgcrypto` extension + trigger that NOTIFYs `pipeline_event`
- [docker-compose.yml](/Users/ravdeepsingh/agentic-platform-local/docker-compose.yml) — add `networks` block joining `agentic-net`

**Backend** (extend [backend/src](/Users/ravdeepsingh/agentic-platform-local/backend/src))
- `services/pipelines.ts` — service for creating runs, fetching status, forwarding approve/reject to n8n
- `services/pipelineEvents.ts` — Postgres `LISTEN pipeline_event` + per-run SSE broadcaster
- `routes/pipelines.ts` — Express router with the 5 endpoints in the API table above
- `server.ts` — wire the router; mount SSE endpoint with `text/event-stream`

**Frontend** (extend [frontend/src](/Users/ravdeepsingh/agentic-platform-local/frontend/src))
- `features/pipelines/PipelineLaunch.tsx`
- `features/pipelines/PipelineDetail.tsx` (SSE consumer with `EventSource`)
- `features/pipelines/PipelineList.tsx`
- `features/pipelines/StageCard.tsx` (reusable per-stage UI block)
- `api/pipelinesApi.ts` — typed client over the existing axios instance
- `App.tsx` — add routes

**Agent definitions** (exported / committed for reproducibility)
- `infra/n8n/workflows/stage-template.json`, plus S1–S7 instances and parent `pipeline.json`
- `infra/dify/apps/sdlc-01-requirements.yml` through `sdlc-07-test.yml`

## First-Week Setup

- **Day 1**: `docker network create agentic-net`; patch existing compose; bring up n8n + Dify; verify `http://localhost:5678` and `http://localhost:8080`. Deploy Azure AI Foundry endpoints (Llama-3.3-70B, Llama-3.1-405B, Mistral-Large, Phi-4); register as model providers in Dify. Add Moonshot API key in Dify as a custom OpenAI-compatible provider for Kimi (or stub out for Option B later).
- **Day 2**: Create 7 Dify apps; generate API keys; create one KB per pilot repo and ingest seed code via Foundry-hosted embedding endpoint (or Dify's bundled embeddings if Foundry embeddings aren't available).
- **Day 3**: Apply both SQL migrations (registry + run-status); register GitHub App; install on 1–2 pilot repos; populate registry rows.
- **Day 4**: Build `stage-template` sub-workflow in n8n with the 4 Postgres status-write nodes around the Dify call; clone for S1–S7; chain in parent `pipeline` workflow.
- **Day 5**: Implement Express `pipelines` service + routes + SSE; add `PipelineLaunch` and `PipelineDetail` screens to the React frontend. Verify a manual UI kickoff lights up stage 1.
- **Day 6**: Register Azure AD app for SharePoint; configure n8n Microsoft OAuth2 credential; build SharePoint ingestion sub-workflow. Optional: wire Slack interactivity via `cloudflared` tunnel for off-app approvals.
- **Day 7**: End-to-end dry run with seed request "Add OAuth login to the customer portal" — start it from the React UI, verify each stage's status flips live in the dashboard, click Approve from the UI between stages, confirm Stage 6 opens a draft PR and Stage 7 reports CI back.

## Verification

End-to-end test (must pass before declaring PoC done):

1. Open the React UI at `http://localhost:3001`; on `PipelineLaunch` pick a pilot repo, type a seed requirement, click Start.
2. UI navigates to `PipelineDetail`; SSE connection opens; Stage 1 flips `running` then `awaiting_approval` within seconds (Llama-3.3-70B on Foundry). Artifact link to the SharePoint draft appears on the stage card.
3. Click **Approve** in the UI → Stage 1 marks `approved`, Stage 2 flips `running`. Click **Reject** on a later stage → pipeline halts with the rejection reason captured in `pipeline_runs.status`.
4. After S5 approval, confirm the GH Projects board has draft issues created by the Sprint Planning agent.
5. After S6 (Codestral), confirm a **draft PR** exists on the pilot repo, is **not** auto-merged, and the PR URL is shown on the stage card.
6. Manually mark the PR ready-for-review → S7 triggers GH Actions; results flow back to the UI as the final `awaiting_approval` artifact (AC coverage matrix).
7. Final approval in UI marks `pipeline_runs.status='completed'`; full timeline visible in `PipelineList`.

Health checks: `docker compose ps` for all three projects shows healthy; Dify `/console/api/setup` returns 200; n8n `/healthz` returns ok; `curl -N http://localhost:5000/api/pipelines/<run_id>/events` streams frames; Foundry endpoint responds to a smoke-test `chat/completions` call from the n8n host.

## Out of Scope (PoC)

- Auto-merging PRs (humans gate this on purpose)
- Production hardening (TLS, secrets manager, autoscaling) — defer until pilot value is proven
- Multi-tenant isolation between teams
- Cost controls / model budget caps (add in week 2 once traffic patterns are visible)
