---
name: reference-dify-admin
description: how to programmatically authenticate to Dify console API for the agentic-platform-local PoC
metadata: 
  node_type: memory
  type: reference
  originSessionId: c732872c-7b8c-4c79-adea-68b66741338e
---

Dify is at `http://docker-vm-dev-01:8080` (via Tailscale) with admin `ravdeeps3@gmail.com`. Console API access pattern (verified working 2026-05-15):

**Authentication**:
1. Base64-encode the password (Dify decodes the `password` field as base64 in `/console/api/login`).
2. POST `/console/api/login` with `{email, password: <b64>, remember_me: true}`. Use a cookie jar (`curl -c`) to capture the response cookies.
3. Three cookies returned: `csrf_token` (JWT, not HttpOnly), `access_token` (HttpOnly), `refresh_token` (HttpOnly).
4. For all subsequent calls, send the cookie jar (`curl -b`) AND the header `X-CSRF-Token: <csrf_token value>`. Bearer auth alone fails CSRF.

**Useful endpoints** (all under `/console/api`):
- `GET /workspaces/current/model-providers` — list installed providers + their credential schemas
- `POST /workspaces/current/model-providers/<provider>/models/credentials` — add a model under a provider. Payload: `{model, model_type:"llm", name (≤30 chars), credentials:{...}}`. Returns `{"result":"success"}` on success, `{"code":"invalid_param",...}` on validation failure.
- `GET /workspaces/current/model-providers/<provider>/models?model_type=llm` — list registered models for a provider.
- `GET /account/profile` — verify auth works.

**Provider IDs used in this project**:
- `langgenius/azure_openai/azure_openai` — Azure OpenAI Service (GPT-4.1)
- `langgenius/azure_ai_studio/azure_ai_studio` — Azure AI Foundry MaaS (Kimi-K2.6, DeepSeek-R1)

**Credential schema gotcha**: fields with `show_on: [{variable:"__model_type", value:"rerank"}]` only apply when adding rerank models. For LLMs, only fields with `show_on: [{variable:"__model_type", value:"llm"}]` are required, even if `required: true` is set on the schema unconditionally.

**Why:** Programmatic provider setup is faster than UI clicks for batch operations. Also serves as a reusable template when adding more models to the project.

**How to apply:** When wiring more models or doing Dify admin tasks, use this auth pattern via `curl` from the user's Mac (which has Tailscale to the VM). Same pattern works for adding apps (`/console/api/apps`) — endpoints discoverable via `grep -r "console_ns.route" ~/agentic-platform-local/infra/dify/api/controllers/console/`.

Related: [[project-sdlc-pipeline-stack]], [[project-deployment-target]]
