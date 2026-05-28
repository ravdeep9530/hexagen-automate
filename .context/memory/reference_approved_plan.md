---
name: reference-approved-plan-sdlc-pipeline
description: location of the approved implementation plan for the n8n+Dify SDLC agent pipeline on agentic-platform-local
metadata: 
  node_type: memory
  type: reference
  originSessionId: c732872c-7b8c-4c79-adea-68b66741338e
---

The approved implementation plan for the SDLC agent pipeline (n8n + Dify + Azure AI Foundry + Kimi) lives at:

`/Users/ravdeepsingh/.claude/plans/so-but-flow-you-wise-parnas.md`

Read it first when resuming work on this project. It covers: architecture, per-stage agent definitions with models, Postgres schema (`pipeline_runs`, `pipeline_stage_status`), Express API contract, React UI screens, n8n stage-workflow pattern, integration auth (GitHub App, Azure AD/Graph for SharePoint, Moonshot for Kimi), and the day-by-day setup checklist.

Related: [[project-sdlc-pipeline-stack]]
