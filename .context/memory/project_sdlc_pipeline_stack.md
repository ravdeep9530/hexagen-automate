---
name: project-sdlc-pipeline-stack
description: agentic-platform-local is being extended into a 7-stage SDLC agent pipeline (Requirements → Optimize → Plan → Design → Sprint → Implementation → Test) — records the approved tooling decisions
metadata: 
  node_type: memory
  type: project
  originSessionId: c732872c-7b8c-4c79-adea-68b66741338e
---

The `agentic-platform-local` repo is being extended with a self-hosted SDLC agent pipeline. The user (ravdeep) approved this stack on 2026-05-15.

**Stack**:
- n8n (orchestrator, integrations, HITL gates) — local Docker, port 5678
- Dify (agent control plane: prompts, RAG, model selection, observability) — local Docker, port 8080 (nginx remapped from 80)
- Existing React frontend (3001) + Express backend (5000) + Postgres (5432) — the React UI is the primary trigger + step-visibility dashboard
- Shared Docker network: `agentic-net` (external)

**Models** (revised 2026-05-15 after user confirmed only 3 Foundry deployments exist):
- **GPT-4.1** (Azure OpenAI Service, resource `carechain-open-ai-ce-dev`) — stages 1 (Requirements), 2 (Optimize), 5 (Sprint planning). Dify provider: `langgenius/azure_openai/azure_openai`, base_model_name `gpt-4.1`.
- **DeepSeek-R1** (Azure AI Foundry MaaS, resource `carechainaistu3962432517`) — stages 3 (Plan), 4 (Design). Inline `<think>` reasoning, needs `max_tokens ≥ 4096`. Dify provider: `langgenius/azure_ai_studio/azure_ai_studio`. Context 163,840.
- **Kimi-K2.6** (same Foundry MaaS resource, Thinking variant) — stages 6 (Implementation), 7 (Test). Returns `reasoning_content` separate from `content`. Supports function calling. Dify provider: same as DeepSeek. Context 131,072.
- All three already wired into Dify on 2026-05-15 via the Dify console API (verified `status=active`).
- Fallback for any stage: swap among the three from Dify UI; no code changes needed.

**Previous (no longer valid) plan** had: Llama-3.3-70B, Llama-3.1-405B, Mistral-Large, Codestral, Kimi-K2 via Moonshot API. Discarded — user has these three Foundry deployments instead.

**Integrations chosen**:
- GitHub multi-repo via GitHub App (not PAT)
- GitHub Projects v2 (NOT Jira) via GraphQL with installation token
- SharePoint (NOT Confluence) via MS Graph application-permission OAuth2
- Slack/Teams optional for PoC (UI handles approvals)

**Critical pattern**: HITL approval at EVERY stage. Approvals can come from UI (preferred) or Slack — first one wins, idempotency guarded by `pipeline_stage_status.status` check before resuming n8n Wait.

**Why:** User wanted open-source, self-hosted, with UI visibility per step and Azure-hosted models. Single-tool options (Dify-only) were rejected as too weak on external orchestration; code-first frameworks (CrewAI/MetaGPT) rejected because the team needs UI to edit agent behavior.

**How to apply:** When extending this repo, default to: n8n nodes for any orchestration/integration logic, Dify apps for any LLM prompt/agent logic, the `pipeline_runs` + `pipeline_stage_status` Postgres tables as the single source of truth for run state, and SSE (not polling) for UI updates. Approved plan with full design lives at `~/.claude/plans/so-but-flow-you-wise-parnas.md`.

Related: [[reference-approved-plan-sdlc-pipeline]]
