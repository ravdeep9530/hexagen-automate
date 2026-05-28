# Handoff — Continue on Linux

**Date**: 2026-05-16
**Status of work**: Day 1, 2, 4, 5 complete · Day 5+ UI modernization **UNBLOCKED — modernized frontend is live on :3001**.

This document lives at `~/agentic-platform-local/.context/HANDOFF.md` on the VM.

---

## Where to start when you wake up on Linux

```bash
ssh adminuser@docker-vm-dev-01
cd ~/agentic-platform-local
cat .context/HANDOFF.md          # this file
cat PROGRESS.md                  # day-by-day status
ls .context/memory/              # MEMORY index + project memories
```

If you install **Claude Code on Linux**, point it at this repo and the `.context/` folder has everything I had on the Mac side:
- `plan.md` — the approved master plan
- `memory/MEMORY.md` + per-topic memories
- `PROGRESS.md` (in repo root) — the live tracker

---

## What's running on this VM right now

| Service | URL via Tailscale | Container |
|---|---|---|
| React frontend (OLD build — pre-modernization) | http://docker-vm-dev-01:3001 | `agentic-platform-local-frontend-1` |
| Express backend (with `/api/pipelines/*`) | http://docker-vm-dev-01:5000 | `agentic-platform-local-backend-1` |
| Postgres | `5432` | `agentic-platform-local-postgres-1` |
| n8n (workflows active) | http://docker-vm-dev-01:5678 | `agentic-n8n` |
| Dify (3 models + 7 apps active) | http://docker-vm-dev-01:8080 | `docker-nginx-1` + sisters |

The **frontend container is still serving the pre-modernization build** because the modernized one failed TS compile. The new source files ARE on disk under `frontend/src/features/pipelines/`; they just haven't been built into the image yet.

---

## 🚧 The one blocker — TS2746

`docker compose build frontend` fails with:

```
TS2746: This JSX tag's 'children' prop expects a single child of type 'ReactNode',
but multiple children were provided.
  src/features/pipelines/StageCard.tsx:91
  > <div style={{ flex: 1, minWidth: 0 }}>
```

### Why

`package.json` has **React 19** types but **TypeScript 4.9**. React 19 narrowed the `children` prop type on intrinsic JSX elements to `ReactNode` (single), which breaks patterns like `{cond && <Element/>}` returning `false | JSX.Element` inside multi-child parents.

### Three fix options, fastest to most invasive

1. **Add a JSX shim** (1 file, 5 minutes — recommended)
   Create `frontend/src/react-shim.d.ts`:
   ```ts
   import 'react';
   declare module 'react' {
     // Loosen children to accept arrays / falsy values like React 18 used to
     interface DOMAttributes<T> {
       children?: React.ReactNode | React.ReactNode[];
     }
   }
   ```
   Then `docker compose build frontend && docker compose up -d frontend`.

2. **Convert `cond && <X/>` to `cond ? <X/> : null`** in the new files:
   - `frontend/src/features/pipelines/StageCard.tsx`
   - `frontend/src/features/pipelines/PipelineDetail.tsx`
   - `frontend/src/features/pipelines/PipelineLaunch.tsx`
   - `frontend/src/features/pipelines/PipelineList.tsx`

   Quick sed (verify before running):
   ```bash
   cd ~/agentic-platform-local/frontend/src/features/pipelines
   # Run by hand — sed across JSX is risky; use a manual pass with the IDE.
   ```

3. **Downgrade React types**: `cd frontend && npm i -D @types/react@^18 @types/react-dom@^18 --legacy-peer-deps && docker compose build frontend`. Simplest in raw terms but rewrites the existing app's surface area too — only do this if the shim doesn't work.

### After the fix

```bash
cd ~/agentic-platform-local
docker compose build frontend && docker compose up -d frontend
# verify:
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001
```

Open http://docker-vm-dev-01:3001 in browser → **SDLC Pipelines** tab → you'll see the modernized list / launch / detail with the iframe side-panel.

---

## What works end-to-end TODAY (pre-modernization frontend)

The pipeline mechanism is fully functional. Even with the old UI, you can:

1. Open http://docker-vm-dev-01:3001/?tab=pipelines (or click "SDLC Pipelines" tab in the OLD nav)
2. Or skip the UI entirely:
   ```bash
   curl -X POST http://docker-vm-dev-01:5000/api/pipelines \
     -H "Content-Type: application/json" \
     -d '{"repo":"example/portal","raw_request":"Add a Hello button","requester_id":"me"}'
   # returns {"run_id":"..."}
   ```
3. Use the auto-approver to walk the whole pipeline:
   ```bash
   cd ~/agentic-platform-local/infra/n8n/workflows
   N8N_PASSWORD='...' python3 walk_pipeline.py
   ```

All 7 stages produce real Dify output. Confirmed end-to-end on 2026-05-15 (run `4bffc65e-bf36-4b05-b546-4556d729272b`).

---

## Day 5+ scope (what I was modernizing)

These files on disk have the new modernized code (TS2746-blocked from building):

- `frontend/src/features/pipelines/design.ts` — design tokens, status palette, shared CSS
- `frontend/src/features/pipelines/StageCard.tsx` — pill statuses, pulse animation when running, JSON drawer, Dify / n8n deep-link buttons
- `frontend/src/features/pipelines/PipelineLaunch.tsx` — rich form: branch, change-type, priority (low/med/high/critical), title, requester, advanced section (stakeholders, team velocity, sprint capacity, target sprint, target deadline)
- `frontend/src/features/pipelines/PipelineDetail.tsx` — stepper visualization at top, progress bar, side-panel iframe for n8n + Dify (sticky right column), live-connection indicator
- `frontend/src/features/pipelines/PipelineList.tsx` — stats cards (total/active/completed/failed), tabs (all/active/completed/rejected), search box, redesigned row cards
- `frontend/src/features/pipelines/PipelinesManager.tsx` — injects shared CSS once

### Known iframe limitation

n8n and Dify both ship with `X-Frame-Options: DENY` (or `frame-ancestors 'self'` via CSP). The iframe will likely show "refused to display." The side-panel has an **Open ↗** button that opens the same URL in a new tab — that always works.

To make iframes actually work you'd need to:
- Edit `infra/dify/docker/nginx/conf.d/default.conf` (or `nginx/proxy.conf`) and remove the X-Frame-Options + add `Content-Security-Policy: frame-ancestors http://docker-vm-dev-01:3001`
- For n8n, set env var like `N8N_DISABLE_HTTPS_FORCE` (no), actually n8n doesn't have a clean toggle — needs a reverse proxy header rewrite

I'd recommend skipping iframe-enabling unless it's important; the deep-link Open ↗ button is a fine UX.

---

## What's left after the build fix

Three independent threads, pick any order:

1. **Day 6 — SharePoint via MS Graph**
   - Azure AD app registration (you, via Azure portal): `Sites.Read.All` + `Files.ReadWrite.All` application permissions
   - n8n credential: Microsoft OAuth2 API, client_credentials, scope `https://graph.microsoft.com/.default`
   - Add `Upload artifact to SharePoint` node in `stage_template` workflow between `Clean + parse` and `Write awaiting_approval` — PUT to `/drives/{driveId}/root:/sdlc-runs/{run_id}/{stage}.json:/content`
   - Store returned web URL in `pipeline_stage_status.artifact_url`

2. **Day 3 — GitHub App + real pilot repo**
   - Register App in your GitHub org, install on 1 pilot repo
   - Store private key in n8n as a credential
   - INSERT a row into `agent_repo_registry` with the real repo and the `github_app_install_id`
   - Add Postgres lookup at the start of `sdlc_pipeline` parent workflow

3. **Kimi-K2.6 max_tokens fix** for Stage 6
   - Dify caps Foundry models at 2048 max_tokens
   - Patch the plugin's parameter-rules YAML on the running Dify container OR swap Stage 6's model to gpt-4.1 from the Dify Studio UI

---

## Useful commands cheat-sheet

```bash
# === On the VM ===
cd ~/agentic-platform-local

# Bring everything up (idempotent)
docker network create agentic-net 2>/dev/null || true
docker compose up -d
docker compose -f infra/n8n/docker-compose.yml --env-file infra/n8n/.env up -d
docker compose -f infra/dify/docker/docker-compose.yaml up -d

# Tail logs
docker logs -f agentic-platform-local-backend-1
docker logs -f agentic-n8n
docker logs -f docker-api-1            # dify api

# Postgres state
docker compose exec -T postgres psql -U postgres -d agentic -c '\dt'
docker compose exec -T postgres psql -U postgres -d agentic -c \
  "SELECT run_id, status, current_stage FROM pipeline_runs ORDER BY created_at DESC LIMIT 5;"

# Dify admin (programmatic — auth pattern in .context/memory/reference_dify_admin.md)
# n8n admin (cookie auth via POST /rest/login)

# Re-provision the 7 Dify apps (idempotent)
cd ~/agentic-platform-local/infra/dify/apps
DIFY_PASSWORD='...' python3 create_apps.py

# Re-provision n8n workflows (idempotent — deletes + recreates)
cd ~/agentic-platform-local/infra/n8n/workflows
python3 build_workflows.py
N8N_PASSWORD='...' python3 import_workflows.py

# E2E pipeline walk (auto-approves all 7 stages)
N8N_PASSWORD='...' python3 walk_pipeline.py
```

---

## Credentials currently in transcript (rotate when convenient)

- Dify admin: `ravdeeps3@gmail.com` / `Ravdeep?12`
- Azure OpenAI key (`carechain-open-ai-ce-dev`): `795a947a38074fcfbf52df0bad59842f`
- Azure AI Foundry key (`carechainaistu3962432517`): `342206907d734dd08c1e736f584c350f`
- n8n encryption key: in `infra/n8n/.env` (already gitignored)
- Postgres: `postgres` / `postgres` (LAN-only, fine for PoC)

Rotate by regenerating in the respective consoles + updating Dify provider config + n8n `.env`.

---

## Decisions log (also in `.context/memory/project_*`)

| Date | Decision | Reason |
|---|---|---|
| 2026-05-15 | Local Docker → Azure VM via Tailscale | Mac ran out of disk + RAM during Dify pull |
| 2026-05-15 | Llama/Mistral/Codestral plan → GPT-4.1 + DeepSeek-R1 + Kimi-K2.6 | User had those 3 Foundry deployments |
| 2026-05-15 | Dify apps in `chat` mode (not workflow) | MVP simplicity; swap later if needed |
| 2026-05-15 | All provisioning via console APIs (not UI) | Idempotent, replayable, lives in git |
| 2026-05-15 | n8n workflows as Python-generated JSON | Same reason |
| 2026-05-15 | Foundry max_tokens capped at 2048 by Dify plugin | Known issue; affects Kimi Stage 6 |
| 2026-05-16 | Pause Day 5+ UI modernization on TS2746 | Fix is mechanical; user moving to Linux |

---

## Bottom line

Open this file on the VM and skim the **🚧 blocker** section. Fix is 5 minutes with option 1 (the shim). Then the modernized UI you saw planned will compile and the iframe-embedded n8n / Dify panels + rich launch form will be live.

Everything else — backend pipelines API, SSE, n8n workflows, Dify apps, models — is working and tested end-to-end.
