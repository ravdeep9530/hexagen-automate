---
name: project-deployment-target
description: "SDLC pipeline stack is deployed on Azure VM docker-vm-dev-01 (via Tailscale), not on the user's Mac as the original plan said"
metadata: 
  node_type: memory
  type: project
  originSessionId: c732872c-7b8c-4c79-adea-68b66741338e
---

The approved plan ([[reference-approved-plan-sdlc-pipeline]]) called for "Local Docker (dev/PoC)" on the user's Mac. **We moved to an Azure VM instead** on 2026-05-15 because the Mac ran out of disk and RAM during Dify image pulls.

**Actual deployment target**:
- Azure VM: `docker-vm-dev-01` — Standard_B2as_v2 (2 vCPU, 8 GiB RAM, 128 GiB OS disk)
- OS: Ubuntu 22.04 LTS, Docker Engine 28.0.2 + Compose v2.34.0
- VM is on a **private vnet** (no public IP), accessed via **Tailscale** mesh VPN
- Tailscale MagicDNS: `docker-vm-dev-01.taila33475.ts.net` → 100.110.33.112
- Tailscale SSH enabled, login as `adminuser`. Mac → `ssh adminuser@docker-vm-dev-01` works without keys.
- `adminuser` is in the `docker` group (no sudo needed for docker commands)
- Passwordless sudo is NOT configured (user must type password for sudo)

**Service URLs from the Mac browser via Tailscale**:
- React frontend → `http://docker-vm-dev-01:3001`
- Express backend → `http://docker-vm-dev-01:5000`
- n8n → `http://docker-vm-dev-01:5678`
- Dify → `http://docker-vm-dev-01:8080`

**n8n quirk**: `N8N_SECURE_COOKIE=false` is set in `infra/n8n/docker-compose.yml` because the Tailscale URL is HTTP, not HTTPS. Fine for PoC over WireGuard; will need TLS via Tailscale Serve / Caddy when public webhooks are wired (Day 6).

**Repo location on VM**: `/home/adminuser/agentic-platform-local/` (mirrors local path structure). Synced via `rsync -az` from Mac, excluding `node_modules`, `build`, `.git`, `infra/dify`. Dify is cloned fresh on the VM at `infra/dify/`.

**Postgres state on VM** (`agentic` DB):
- 11 pre-existing application tables from prior work (agents, projects, prior_auth_requests, tracked_pull_requests, etc.)
- 3 new SDLC tables applied: `agent_repo_registry`, `pipeline_runs`, `pipeline_stage_status`
- `n8n` database created separately for n8n's own state

**Why:** Mac couldn't host Dify (8+ services, ~6 GB RAM). VM was already provisioned in Azure (CareChain Cloud subscription) so the user moved the workload there. Tailscale handles the private-vnet access problem cleanly.

**How to apply:** When the plan says `localhost:PORT`, use `docker-vm-dev-01:PORT` instead. When syncing code changes from Mac → VM, use `rsync -az --exclude=node_modules --exclude=build --exclude=.git --exclude=infra/dify SRC/ adminuser@docker-vm-dev-01:DEST/`. When running docker compose commands, SSH first and `cd ~/agentic-platform-local/...` then `docker compose ...` (no sudo needed). Dify's nginx is aliased on `agentic-net` as `dify-nginx` (override file at `infra/dify/docker/docker-compose.override.yaml`) so n8n can call it via `http://dify-nginx`.

Related: [[project-sdlc-pipeline-stack]], [[reference-approved-plan-sdlc-pipeline]]
