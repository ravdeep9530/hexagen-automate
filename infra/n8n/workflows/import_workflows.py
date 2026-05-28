#!/usr/bin/env python3
"""Import workflow JSON files into n8n via its /rest API (cookie auth).

Order:
  1. POST stage_template.json
  2. POST requirements_stage_template.json (Stage 1's dedicated template)
  3. patch sdlc_pipeline.json with both template ids
  4. POST sdlc_pipeline.json
  5. activate sdlc_pipeline (so the /webhook/pipeline/start endpoint is live)
"""
import base64
import json
import os
import sys
from pathlib import Path

import requests

N8N = os.environ.get("N8N_BASE", "http://docker-vm-dev-01:5678")
EMAIL = os.environ.get("N8N_EMAIL", "ravdeeps3@gmail.com")
PASSWORD = os.environ.get("N8N_PASSWORD", "")
HERE = Path(__file__).parent


def login(s: requests.Session) -> None:
    r = s.post(
        f"{N8N}/rest/login",
        json={"emailOrLdapLoginId": EMAIL, "password": PASSWORD},
        timeout=10,
    )
    r.raise_for_status()


def list_workflows(s: requests.Session) -> list[dict]:
    r = s.get(f"{N8N}/rest/workflows?filter={{}}", timeout=10)
    r.raise_for_status()
    payload = r.json()
    data = payload.get("data", payload)
    return data if isinstance(data, list) else data.get("data", [])


def find_by_name(workflows: list[dict], name: str) -> dict | None:
    for w in workflows:
        if w.get("name") == name:
            return w
    return None


def post_workflow(s: requests.Session, body: dict) -> dict:
    # /rest/workflows expects the workflow body. Strip top-level fields that aren't accepted.
    payload = {k: v for k, v in body.items() if k in ("name", "nodes", "connections", "settings", "staticData", "pinData", "meta")}
    r = s.post(f"{N8N}/rest/workflows", json=payload, timeout=15)
    if r.status_code >= 400:
        print(f"  POST failed {r.status_code}: {r.text[:600]}")
        r.raise_for_status()
    return r.json().get("data", r.json())


def put_workflow(s: requests.Session, wf_id: str, body: dict) -> dict:
    payload = {k: v for k, v in body.items() if k in ("name", "nodes", "connections", "settings", "staticData", "pinData", "meta")}
    r = s.put(f"{N8N}/rest/workflows/{wf_id}", json=payload, timeout=15)
    if r.status_code >= 400:
        print(f"  PUT failed {r.status_code}: {r.text[:600]}")
        r.raise_for_status()
    return r.json().get("data", r.json())


def activate(s: requests.Session, wf_id: str) -> None:
    r = s.post(f"{N8N}/rest/workflows/{wf_id}/activate", timeout=10)
    if r.status_code >= 400:
        # Try alternate endpoint
        r = s.patch(f"{N8N}/rest/workflows/{wf_id}", json={"active": True}, timeout=10)
    if r.status_code >= 400:
        print(f"  activate failed {r.status_code}: {r.text[:400]}")


def deactivate(s: requests.Session, wf_id: str) -> None:
    # Get latest versionId, then call deactivate
    try:
        r = s.get(f"{N8N}/rest/workflows/{wf_id}", timeout=10)
        vid = r.json().get("data", {}).get("versionId")
        if vid:
            s.post(f"{N8N}/rest/workflows/{wf_id}/deactivate", json={"versionId": vid}, timeout=10)
    except Exception:
        pass


def delete_workflow(s: requests.Session, wf_id: str) -> None:
    deactivate(s, wf_id)
    s.delete(f"{N8N}/rest/workflows/{wf_id}", timeout=10)


def upsert(s: requests.Session, name: str, body: dict, existing: list[dict]) -> dict:
    found = find_by_name(existing, name)
    if found:
        wf_id = found["id"]
        print(f"  {name}: deleting existing id={wf_id} and recreating")
        delete_workflow(s, wf_id)
    print(f"  {name}: creating new")
    return post_workflow(s, body)


def patch_template_ids(body: dict, stage_id: str, requirements_id: str) -> dict:
    """Replace template-id placeholders in the parent workflow."""
    raw = json.dumps(body)
    raw = raw.replace("__STAGE_TEMPLATE_ID__", stage_id)
    raw = raw.replace("__REQUIREMENTS_TEMPLATE_ID__", requirements_id)
    return json.loads(raw)


def main():
    if not PASSWORD:
        sys.exit("N8N_PASSWORD env var required")

    stage_body = json.loads((HERE / "stage_template.json").read_text())
    req_body = json.loads((HERE / "requirements_stage_template.json").read_text())
    parent_body = json.loads((HERE / "sdlc_pipeline.json").read_text())

    s = requests.Session()
    login(s)
    existing = list_workflows(s)
    print(f"existing workflows: {[w.get('name') for w in existing]}")

    # 1. Import stage_template (no activation needed — it's a sub-workflow)
    stage = upsert(s, "stage_template", stage_body, existing)
    stage_id = stage["id"]
    print(f"  stage_template id={stage_id}")

    # 2. Import requirements_stage_template (Stage 1's dedicated template)
    req = upsert(s, "requirements_stage_template", req_body, existing)
    req_id = req["id"]
    print(f"  requirements_stage_template id={req_id}")

    # 3. Patch parent to reference both template ids, then import
    parent_body = patch_template_ids(parent_body, stage_id, req_id)
    parent = upsert(s, "sdlc_pipeline", parent_body, existing)
    parent_id = parent["id"]
    print(f"  sdlc_pipeline  id={parent_id}")

    # 4. Activate parent so the webhook is live
    print("  activating sdlc_pipeline...")
    activate(s, parent_id)

    # Persist ids for later use
    (HERE / ".workflow-ids").write_text(
        f"STAGE_TEMPLATE_ID={stage_id}\n"
        f"REQUIREMENTS_TEMPLATE_ID={req_id}\n"
        f"SDLC_PIPELINE_ID={parent_id}\n"
    )
    print(f"  wrote {HERE / '.workflow-ids'}")


if __name__ == "__main__":
    main()
