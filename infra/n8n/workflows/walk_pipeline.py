#!/usr/bin/env python3
"""End-to-end walk: trigger pipeline, then auto-approve each stage as it arrives.

Polls Postgres for awaiting_approval, POSTs the resume URL, repeats until completed/rejected/timeout.
"""
import json
import os
import subprocess
import sys
import time

import requests

N8N_BASE = os.environ.get("N8N_BASE", "http://docker-vm-dev-01:5678")
RAW_REQUEST = os.environ.get("RAW_REQUEST", "Add a Hello button to the customer portal landing page")
REPO = os.environ.get("REPO", "example/portal")
USER = os.environ.get("REQUESTER", "auto-walk")


def psql_one(query: str) -> str:
    out = subprocess.run(
        ["ssh", "adminuser@docker-vm-dev-01",
         f"cd ~/agentic-platform-local && docker compose exec -T postgres psql -U postgres -d agentic -t -A -c \"{query}\""],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def main():
    print(f"=> kicking off pipeline (repo={REPO})")
    r = requests.post(f"{N8N_BASE}/webhook/pipeline/start", json={
        "repo": REPO,
        "raw_request": RAW_REQUEST,
        "requester_id": USER,
    }, timeout=30)
    r.raise_for_status()
    run_id = r.json()["run_id"]
    print(f"   run_id={run_id}")

    seen_approved: set[str] = set()
    deadline = time.time() + 600  # 10 min total
    while time.time() < deadline:
        status = psql_one(f"SELECT status FROM pipeline_runs WHERE run_id='{run_id}'")
        if status == "completed":
            print("\n✅ pipeline COMPLETED")
            break
        if status == "rejected":
            print("\n❌ pipeline REJECTED")
            break
        if status == "failed":
            print("\n💥 pipeline FAILED")
            break

        # Find a stage in awaiting_approval that we haven't auto-approved yet
        row = psql_one(
            f"SELECT stage || '|' || resume_webhook_url FROM pipeline_stage_status "
            f"WHERE run_id='{run_id}' AND status='awaiting_approval' "
            f"ORDER BY id DESC LIMIT 1"
        )
        if row:
            stage, resume = row.split("|", 1)
            if stage not in seen_approved:
                seen_approved.add(stage)
                resume = resume.replace("http://localhost:5678", N8N_BASE)
                print(f"   ↳ approving stage={stage}")
                ar = requests.post(resume, json={"decision": "approved"}, timeout=30)
                print(f"     HTTP {ar.status_code}  {ar.text[:80]}")
                time.sleep(2)
                continue
        time.sleep(4)
    else:
        print("\n⏰ timed out waiting")

    print("\n=== final timeline ===")
    timeline = psql_one(
        f"SELECT stage || ' ' || status || ' (' || EXTRACT(EPOCH FROM (finished_at - started_at))::int || 's)' "
        f"FROM pipeline_stage_status WHERE run_id='{run_id}' ORDER BY id"
    )
    print(timeline)


if __name__ == "__main__":
    main()
