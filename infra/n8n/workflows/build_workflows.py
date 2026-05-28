#!/usr/bin/env python3
"""Generate n8n workflow JSON files for the SDLC pipeline.

Outputs:
- stage_template.json — runs ONE SDLC stage end-to-end (lookup → Dify → status writes → Wait → IF)
- sdlc_pipeline.json  — parent workflow: Webhook → seven sequential calls to stage_template

Reads POSTGRES_CRED_ID from .env-cred-ids.
"""
import json
import os
import uuid
from pathlib import Path

HERE = Path(__file__).parent

# Load Postgres credential id.
env = dict(line.strip().split("=", 1) for line in (HERE / ".env-cred-ids").read_text().strip().splitlines() if "=" in line)
PG_CRED_ID = env["POSTGRES_CRED_ID"]

STAGES = ["requirements", "optimize", "plan", "design", "sprint", "implementation", "test"]

# Model labels shown in the UI activity ticker. Match the providers wired into
# Dify (see infra/dify config). Generic stage_template substitutes the stage's
# label via an expression — see _activity_calling_dify().
STAGE_MODEL = {
    "requirements": "gpt-4.1",
    "optimize": "gpt-4.1",
    "plan": "DeepSeek-R1",
    "design": "DeepSeek-R1",
    "sprint": "gpt-4.1",
    "implementation": "gpt-4.1",
    "test": "Kimi-K2.6",
}


def _activity_calling_dify_expr() -> str:
    """Activity string fragment for queryReplacement.
    MUST be a `{{ ... }}` expression (not plain text) — n8n's Postgres node
    only counts {{}}-wrapped values as parameters when splitting on commas.
    Also: no commas inside the {{}} block or n8n splits early.
    """
    return "{{ 'Calling Dify…' }}"


def nid() -> str:
    return str(uuid.uuid4())


def node(name: str, ntype: str, params: dict, pos: tuple[int, int], *, type_version: int = 1, credentials: dict | None = None) -> dict:
    n = {
        "id": nid(),
        "name": name,
        "type": ntype,
        "typeVersion": type_version,
        "position": list(pos),
        "parameters": params,
    }
    if credentials:
        n["credentials"] = credentials
    return n


def pg_cred() -> dict:
    return {"postgres": {"id": PG_CRED_ID, "name": "agentic-postgres"}}


# ============================================================
# stage_template — runs ONE stage
# ============================================================

def build_stage_template() -> dict:
    nodes = []
    x = 240
    dx = 240
    y = 300

    # 1. Execute Workflow Trigger — accepts inputs from the parent
    trig = node(
        "Start",
        "n8n-nodes-base.executeWorkflowTrigger",
        {
            "inputSource": "passthrough",
        },
        (x, y),
        type_version=1.1,
    )
    nodes.append(trig); x += dx

    # 2. Postgres — lookup api_key for this stage
    lookup = node(
        "Lookup Dify app key",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": "SELECT app_id, api_key FROM dify_app_keys WHERE stage = $1",
            "options": {"queryReplacement": "={{ $json.stage_name }}"},
        },
        (x, y),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(lookup); x += dx

    # 3. Postgres — upsert stage_status to 'running' + announce activity.
    # current_activity is what the UI ticker shows while we wait on the Dify call.
    mark_running = node(
        "Mark stage running",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "INSERT INTO pipeline_stage_status (run_id, stage, status, started_at, current_activity) "
                "VALUES ($1::uuid, $2, 'running', now(), $3) "
                "ON CONFLICT (run_id, stage) DO UPDATE SET status='running', started_at=now(), current_activity=$3"
            ),
            "options": {"queryReplacement": (
                "={{ $('Start').item.json.run_id }},"
                "{{ $('Start').item.json.stage_name }},"
                f"{_activity_calling_dify_expr()}"
            )},
        },
        (x, y),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(mark_running); x += dx

    # 4. HTTP Request — call Dify chat-messages
    dify_call = node(
        "Call Dify",
        "n8n-nodes-base.httpRequest",
        {
            "method": "POST",
            "url": "http://dify-nginx/v1/chat-messages",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "Authorization", "value": "=Bearer {{ $('Lookup Dify app key').item.json.api_key }}"},
                    {"name": "Content-Type", "value": "application/json"},
                ]
            },
            "sendBody": True,
            "contentType": "json",
            "specifyBody": "json",
            # Bake design_preferences into the query text. Dify ignores
            # `inputs.*` fields that aren't declared as user_input_form
            # variables, so the only reliable way to surface design intent
            # to the model is via the `query` (user message). The parent
            # workflow forwards design_preferences as a JSON string via
            # inputs.design_preferences (or 'null' when absent).
            "jsonBody": "={{ JSON.stringify({\n  inputs: $('Start').item.json.inputs || {},\n  query: $('Start').item.json.query + (($('Start').item.json.inputs && $('Start').item.json.inputs.design_preferences && $('Start').item.json.inputs.design_preferences !== 'null') ? ('\\n\\ndesign_preferences: ' + $('Start').item.json.inputs.design_preferences) : ''),\n  response_mode: 'blocking',\n  user: 'n8n-' + $('Start').item.json.run_id\n}) }}",
            "options": {"timeout": 180000},
        },
        (x, y),
        type_version=4.2,
    )
    nodes.append(dify_call); x += dx

    # 5. Code — strip <think> blocks, attempt JSON parse, expose answer & parsed
    code_clean = node(
        "Clean + parse",
        "n8n-nodes-base.code",
        {
            "language": "javaScript",
            "mode": "runOnceForEachItem",
            "jsCode": (
                "const body = $input.item.json;\n"
                "let answer = (body.answer || '').toString();\n"
                "// strip DeepSeek <think>...</think> reasoning if present\n"
                "answer = answer.replace(/<think>[\\s\\S]*?<\\/think>\\s*/g, '').trim();\n"
                "// strip leading ```json fences if Kimi wraps the output\n"
                "answer = answer.replace(/^```(?:json)?\\s*/i, '').replace(/```\\s*$/, '').trim();\n"
                "let parsed = null;\n"
                "try { parsed = JSON.parse(answer); } catch (e) { /* leave null */ }\n"
                "return { json: { answer, parsed, dify_message_id: body.id || body.message_id || null, dify_conversation_id: body.conversation_id || null, usage: (body.metadata && body.metadata.usage) || null } };\n"
            ),
        },
        (x, y),
        type_version=2,
    )
    nodes.append(code_clean); x += dx

    # 6x. HTTP Request — call backend sprint orchestrator. For the implementation
    # stage, this iterates over every sprint ticket, opens one draft PR per
    # ticket (topologically ordered), and optionally scaffolds the project
    # first from a curated template. For other stages the backend returns
    # immediately so this node is generic.
    gh_pr = node(
        "Create GitHub PR",
        "n8n-nodes-base.httpRequest",
        {
            "method": "POST",
            "url": "http://agentic-platform-local-backend-1:5000/api/agent/implement-sprint",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "Content-Type", "value": "application/json"},
                ]
            },
            "sendBody": True,
            "contentType": "json",
            "specifyBody": "json",
            "jsonBody": (
                "={{ JSON.stringify({\n"
                "  stage_name: $('Start').item.json.stage_name,\n"
                "  run_id: $('Start').item.json.run_id,\n"
                "  repo: ($('Start').item.json.inputs && $('Start').item.json.inputs.repo_full_name) || null,\n"
                "  sprint_json: ($('Start').item.json.inputs && $('Start').item.json.inputs.sprint_json) || null,\n"
                "  design_excerpt: ($('Start').item.json.inputs && $('Start').item.json.inputs.design_excerpt) || null,\n"
                "  tech_stack: ($('Start').item.json.inputs && $('Start').item.json.inputs.tech_stack) || null\n"
                "}) }}"
            ),
            # Multi-ticket runs can take a while (one Dify call + npm install +
            # next build per ticket). 20-minute upper bound is conservative.
            "options": {"timeout": 1200000},
        },
        (x, y),
        type_version=4.2,
    )
    # If the backend call fails we still want SharePoint upload + status row to
    # run, so the stage isn't blocked entirely.
    gh_pr["continueOnFail"] = True
    nodes.append(gh_pr); x += dx

    # 6a. HTTP Request — fetch a short-lived MS Graph access token (client_credentials)
    get_sp_token = node(
        "Get SharePoint token",
        "n8n-nodes-base.httpRequest",
        {
            "method": "POST",
            "url": "=https://login.microsoftonline.com/{{ $env.SHAREPOINT_TENANT_ID }}/oauth2/v2.0/token",
            "sendBody": True,
            "contentType": "form-urlencoded",
            "bodyParameters": {
                "parameters": [
                    {"name": "grant_type",    "value": "client_credentials"},
                    {"name": "client_id",     "value": "={{ $env.SHAREPOINT_CLIENT_ID }}"},
                    {"name": "client_secret", "value": "={{ $env.SHAREPOINT_CLIENT_SECRET }}"},
                    {"name": "scope",         "value": "https://graph.microsoft.com/.default"},
                ]
            },
            "options": {"timeout": 15000},
        },
        (x, y),
        type_version=4.2,
    )
    get_sp_token["continueOnFail"] = True
    nodes.append(get_sp_token); x += dx

    # 6b. HTTP Request — PUT artifact JSON to SharePoint (auto-creates sub-folders)
    upload_sp = node(
        "Upload to SharePoint",
        "n8n-nodes-base.httpRequest",
        {
            "method": "PUT",
            "url": (
                "=https://graph.microsoft.com/v1.0/drives/{{ $env.SHAREPOINT_DRIVE_ID }}"
                "/root:/{{ $env.SHAREPOINT_FOLDER }}"
                "/{{ $('Start').item.json.run_id }}"
                "/{{ $('Start').item.json.stage_name }}.json:/content"
            ),
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "Authorization", "value": "=Bearer {{ $('Get SharePoint token').item.json.access_token }}"},
                    {"name": "Content-Type",  "value": "application/json"},
                ]
            },
            "sendBody": True,
            "contentType": "raw",
            "rawContentType": "application/json",
            "body": (
                "={{ JSON.stringify({"
                "  stage: $('Start').item.json.stage_name,"
                "  run_id: $('Start').item.json.run_id,"
                "  answer: $('Clean + parse').item.json.answer,"
                "  parsed: $('Clean + parse').item.json.parsed,"
                "  usage: $('Clean + parse').item.json.usage"
                "}) }}"
            ),
            "options": {"timeout": 30000},
        },
        (x, y),
        type_version=4.2,
    )
    # If SharePoint upload fails for any reason, continue so the stage isn't blocked.
    upload_sp["continueOnFail"] = True
    nodes.append(upload_sp); x += dx

    # 6c. Postgres — write the stage_status row to awaiting_approval with artifact + resume URL + artifact_url.
    # Clears current_activity since the UI now derives ticker text from status itself.
    write_status = node(
        "Write awaiting_approval",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "UPDATE pipeline_stage_status SET "
                "status='awaiting_approval', "
                "dify_run_id=$3, "
                "artifact_json=$4::jsonb, "
                "resume_webhook_url=$5, "
                "artifact_url=$6, "
                "current_activity=NULL, "
                "finished_at=now() "
                "WHERE run_id=$1::uuid AND stage=$2"
            ),
            "options": {"queryReplacement": (
                "={{ $('Start').item.json.run_id }},"
                "{{ $('Start').item.json.stage_name }},"
                "{{ $('Clean + parse').item.json.dify_message_id }},"
                "={{ JSON.stringify({"
                "  answer: $('Clean + parse').item.json.answer,"
                "  parsed: $('Clean + parse').item.json.parsed,"
                "  usage: $('Clean + parse').item.json.usage,"
                # For non-implementation stages this is null; for implementation
                # it carries the full sprint result returned by the backend:
                # { pr_urls, outcomes, succeeded_count, failed_count,"
                # skipped_count, scaffold }
                "  sprint: $('Create GitHub PR').item.json && $('Create GitHub PR').item.json.outcomes ? $('Create GitHub PR').item.json : null"
                "}) }},"
                "={{ $execution.resumeUrl }},"
                # Artifact URL: scaffold PR > first ticket PR > SharePoint fallback.
                "={{ ($('Create GitHub PR').item.json && $('Create GitHub PR').item.json.scaffold && $('Create GitHub PR').item.json.scaffold.pr_url)"
                " || ($('Create GitHub PR').item.json && Array.isArray($('Create GitHub PR').item.json.pr_urls) && $('Create GitHub PR').item.json.pr_urls[0])"
                " || ($('Upload to SharePoint').item.json && $('Upload to SharePoint').item.json.webUrl"
                "      ? $('Upload to SharePoint').item.json.webUrl : null) }}"
            )},
        },
        (x, y),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(write_status); x += dx

    # 7. Wait — pause for resume webhook (24h timeout). The resume URL is
    # available at $execution.resumeUrl and is what gets POSTed by the UI/Slack
    # to advance the stage. We do NOT set webhookSuffix so the URL stored in
    # resume_webhook_url matches exactly what n8n will accept.
    wait = node(
        "Wait for approval",
        "n8n-nodes-base.wait",
        {
            "resume": "webhook",
            "httpMethod": "POST",
            "responseMode": "onReceived",
            "options": {},
            "limitWaitTime": True,
            "limitType": "afterTimeInterval",
            "resumeAmount": 24,
            "resumeUnit": "hours",
        },
        (x, y),
        type_version=1.1,
    )
    nodes.append(wait); x += dx

    # 8. IF — approved?
    decide = node(
        "Approved?",
        "n8n-nodes-base.if",
        {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                "conditions": [
                    {
                        "id": nid(),
                        "leftValue": "={{ $json.body.decision || $json.decision }}",
                        "rightValue": "approved",
                        "operator": {"type": "string", "operation": "equals"},
                    }
                ],
                "combinator": "and",
            },
        },
        (x, y),
        type_version=2,
    )
    nodes.append(decide); x += dx

    # 9a. Postgres on approve — mark approved + clear activity
    on_approve = node(
        "Mark approved",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": "UPDATE pipeline_stage_status SET status='approved', current_activity=NULL WHERE run_id=$1::uuid AND stage=$2",
            "options": {"queryReplacement": "={{ $('Start').item.json.run_id }},{{ $('Start').item.json.stage_name }}"},
        },
        (x, y - 120),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(on_approve)

    # 9b. Postgres on reject — mark rejected + halt + clear activity
    on_reject = node(
        "Mark rejected",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "UPDATE pipeline_stage_status SET status='rejected', current_activity=NULL, error=$3 WHERE run_id=$1::uuid AND stage=$2; "
                "UPDATE pipeline_runs SET status='rejected' WHERE run_id=$1::uuid"
            ),
            "options": {"queryReplacement": (
                "={{ $('Start').item.json.run_id }},"
                "{{ $('Start').item.json.stage_name }},"
                "{{ ($json.body && $json.body.reason) || $json.reason || '' }}"
            )},
        },
        (x, y + 120),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(on_reject); x += dx

    # Final passthrough — return parsed artifact to parent
    final_ok = node(
        "Return artifact",
        "n8n-nodes-base.set",
        {
            "mode": "manual",
            "duplicateItem": False,
            "assignments": {
                "assignments": [
                    {"id": nid(), "name": "stage", "value": "={{ $('Start').item.json.stage_name }}", "type": "string"},
                    {"id": nid(), "name": "status", "value": "approved", "type": "string"},
                    {"id": nid(), "name": "parsed", "value": "={{ $('Clean + parse').item.json.parsed }}", "type": "object"},
                    {"id": nid(), "name": "answer", "value": "={{ $('Clean + parse').item.json.answer }}", "type": "string"},
                ]
            },
            "options": {},
        },
        (x, y - 120),
        type_version=3.4,
    )
    nodes.append(final_ok)

    final_rejected = node(
        "Return rejected",
        "n8n-nodes-base.set",
        {
            "mode": "manual",
            "duplicateItem": False,
            "assignments": {
                "assignments": [
                    {"id": nid(), "name": "stage", "value": "={{ $('Start').item.json.stage_name }}", "type": "string"},
                    {"id": nid(), "name": "status", "value": "rejected", "type": "string"},
                    {"id": nid(), "name": "reason", "value": "={{ ($('Approved?').item.json.body && $('Approved?').item.json.body.reason) || '' }}", "type": "string"},
                ]
            },
            "options": {},
        },
        (x, y + 120),
        type_version=3.4,
    )
    nodes.append(final_rejected)

    # Build connections
    def link(src: str, dst: str, src_out: int = 0):
        return {
            src: {
                "main": [[{"node": dst, "type": "main", "index": 0}]] if src_out == 0 else None
            }
        }

    connections: dict = {}
    chain = [
        ("Start",                    "Lookup Dify app key"),
        ("Lookup Dify app key",      "Mark stage running"),
        ("Mark stage running",       "Call Dify"),
        ("Call Dify",                "Clean + parse"),
        ("Clean + parse",            "Create GitHub PR"),
        ("Create GitHub PR",         "Get SharePoint token"),
        ("Get SharePoint token",     "Upload to SharePoint"),
        ("Upload to SharePoint",     "Write awaiting_approval"),
        ("Write awaiting_approval",  "Wait for approval"),
        ("Wait for approval",        "Approved?"),
    ]
    for src, dst in chain:
        connections[src] = {"main": [[{"node": dst, "type": "main", "index": 0}]]}

    # IF node has 2 outputs (true / false)
    connections["Approved?"] = {
        "main": [
            [{"node": "Mark approved", "type": "main", "index": 0}],
            [{"node": "Mark rejected", "type": "main", "index": 0}],
        ]
    }
    connections["Mark approved"] = {"main": [[{"node": "Return artifact", "type": "main", "index": 0}]]}
    connections["Mark rejected"] = {"main": [[{"node": "Return rejected", "type": "main", "index": 0}]]}

    return {
        "name": "stage_template",
        "nodes": nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "staticData": None,
        "pinData": {},
        "meta": {"description": "Runs ONE SDLC stage: Dify call → status writes → HITL wait → branch on approval"},
    }


# ============================================================
# requirements_stage_template — runs Stage 1 only
# ============================================================
#
# Forked from build_stage_template with three differences:
#   1. SharePoint upload is REMOVED — the backend uploads on approval so
#      only the final approved JSON lands in SharePoint.
#   2. Status write conditionally chooses 'awaiting_clarification' (when
#      parsed.open_questions is non-empty) vs 'awaiting_approval'.
#   3. dify_conversation_id is persisted so backend follow-up turns
#      continue the same Dify chat.
# The single Wait node remains alive across clarification rounds; backend
# mutates artifact_json freely and the eventual approve/reject hits this
# same resume URL.

def build_requirements_stage_template() -> dict:
    nodes = []
    x = 240
    dx = 240
    y = 300

    trig = node("Start", "n8n-nodes-base.executeWorkflowTrigger",
                {"inputSource": "passthrough"}, (x, y), type_version=1.1)
    nodes.append(trig); x += dx

    lookup = node("Lookup Dify app key", "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": "SELECT app_id, api_key FROM dify_app_keys WHERE stage = $1",
            "options": {"queryReplacement": "={{ $json.stage_name }}"},
        },
        (x, y), type_version=2.5, credentials=pg_cred())
    nodes.append(lookup); x += dx

    mark_running = node("Mark stage running", "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "INSERT INTO pipeline_stage_status (run_id, stage, status, started_at, current_activity) "
                "VALUES ($1::uuid, $2, 'running', now(), $3) "
                "ON CONFLICT (run_id, stage) DO UPDATE SET status='running', started_at=now(), current_activity=$3"
            ),
            "options": {"queryReplacement": (
                "={{ $('Start').item.json.run_id }},"
                "{{ $('Start').item.json.stage_name }},"
                # Must be a {{}} expression for n8n to count it as a param.
                f"{{{{ 'Calling Dify ({STAGE_MODEL['requirements']})…' }}}}"
            )},
        },
        (x, y), type_version=2.5, credentials=pg_cred())
    nodes.append(mark_running); x += dx

    dify_call = node("Call Dify", "n8n-nodes-base.httpRequest",
        {
            "method": "POST",
            "url": "http://dify-nginx/v1/chat-messages",
            "sendHeaders": True,
            "headerParameters": {"parameters": [
                {"name": "Authorization", "value": "=Bearer {{ $('Lookup Dify app key').item.json.api_key }}"},
                {"name": "Content-Type", "value": "application/json"},
            ]},
            "sendBody": True, "contentType": "json", "specifyBody": "json",
            # Bake design_preferences into the query text. Dify ignores
            # `inputs.*` fields that aren't declared as user_input_form
            # variables, so the only reliable way to surface design intent
            # to the model is via the `query` (user message). The parent
            # workflow forwards design_preferences as a JSON string via
            # inputs.design_preferences (or 'null' when absent).
            "jsonBody": "={{ JSON.stringify({\n  inputs: $('Start').item.json.inputs || {},\n  query: $('Start').item.json.query + (($('Start').item.json.inputs && $('Start').item.json.inputs.design_preferences && $('Start').item.json.inputs.design_preferences !== 'null') ? ('\\n\\ndesign_preferences: ' + $('Start').item.json.inputs.design_preferences) : ''),\n  response_mode: 'blocking',\n  user: 'n8n-' + $('Start').item.json.run_id\n}) }}",
            "options": {"timeout": 180000},
        },
        (x, y), type_version=4.2)
    nodes.append(dify_call); x += dx

    code_clean = node("Clean + parse", "n8n-nodes-base.code",
        {
            "language": "javaScript",
            "mode": "runOnceForEachItem",
            "jsCode": (
                "const body = $input.item.json;\n"
                "let answer = (body.answer || '').toString();\n"
                "answer = answer.replace(/<think>[\\s\\S]*?<\\/think>\\s*/g, '').trim();\n"
                "answer = answer.replace(/^```(?:json)?\\s*/i, '').replace(/```\\s*$/, '').trim();\n"
                "let parsed = null;\n"
                "try { parsed = JSON.parse(answer); } catch (e) { /* leave null */ }\n"
                "const openQs = (parsed && Array.isArray(parsed.open_questions)) ? parsed.open_questions : [];\n"
                "return { json: {\n"
                "  answer, parsed,\n"
                "  next_status: openQs.length > 0 ? 'awaiting_clarification' : 'awaiting_approval',\n"
                "  dify_message_id: body.id || body.message_id || null,\n"
                "  dify_conversation_id: body.conversation_id || null,\n"
                "  usage: (body.metadata && body.metadata.usage) || null\n"
                "} };\n"
            ),
        },
        (x, y), type_version=2)
    nodes.append(code_clean); x += dx

    # Write the status row. Status field is data-driven (awaiting_clarification
    # or awaiting_approval). Note: no SharePoint URL — backend uploads on
    # approval, then patches artifact_url itself.
    write_status = node("Write stage status", "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "UPDATE pipeline_stage_status SET "
                "status=$3, "
                "dify_run_id=$4, "
                "dify_conversation_id=$5, "
                "artifact_json=$6::jsonb, "
                "resume_webhook_url=$7, "
                "current_activity=NULL, "
                "finished_at=now() "
                "WHERE run_id=$1::uuid AND stage=$2"
            ),
            "options": {"queryReplacement": (
                "={{ $('Start').item.json.run_id }},"
                "{{ $('Start').item.json.stage_name }},"
                "{{ $('Clean + parse').item.json.next_status }},"
                "{{ $('Clean + parse').item.json.dify_message_id }},"
                "{{ $('Clean + parse').item.json.dify_conversation_id }},"
                "={{ JSON.stringify({"
                "  answer: $('Clean + parse').item.json.answer,"
                "  parsed: $('Clean + parse').item.json.parsed,"
                "  usage: $('Clean + parse').item.json.usage,"
                "  source: 'dify',"
                "  version: 1,"
                "  clarification_rounds: []"
                "}) }},"
                "={{ $execution.resumeUrl }}"
            )},
        },
        (x, y), type_version=2.5, credentials=pg_cred())
    nodes.append(write_status); x += dx

    # Wait 7 days — long enough to cover clarification rounds + approval.
    # Backend clarification submissions never POST here; only the final
    # approve/reject decision does (via pipelineService.decideStage).
    wait = node("Wait for approval", "n8n-nodes-base.wait",
        {
            "resume": "webhook", "httpMethod": "POST", "responseMode": "onReceived",
            "options": {},
            "limitWaitTime": True, "limitType": "afterTimeInterval",
            "resumeAmount": 7, "resumeUnit": "days",
        },
        (x, y), type_version=1.1)
    nodes.append(wait); x += dx

    decide = node("Approved?", "n8n-nodes-base.if",
        {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                "conditions": [{
                    "id": nid(),
                    "leftValue": "={{ $json.body.decision || $json.decision }}",
                    "rightValue": "approved",
                    "operator": {"type": "string", "operation": "equals"},
                }],
                "combinator": "and",
            },
        },
        (x, y), type_version=2)
    nodes.append(decide); x += dx

    on_approve = node("Mark approved", "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": "UPDATE pipeline_stage_status SET status='approved', current_activity=NULL WHERE run_id=$1::uuid AND stage=$2",
            "options": {"queryReplacement": "={{ $('Start').item.json.run_id }},{{ $('Start').item.json.stage_name }}"},
        },
        (x, y - 120), type_version=2.5, credentials=pg_cred())
    nodes.append(on_approve)

    on_reject = node("Mark rejected", "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "UPDATE pipeline_stage_status SET status='rejected', current_activity=NULL, error=$3 WHERE run_id=$1::uuid AND stage=$2; "
                "UPDATE pipeline_runs SET status='rejected' WHERE run_id=$1::uuid"
            ),
            "options": {"queryReplacement": (
                "={{ $('Start').item.json.run_id }},"
                "{{ $('Start').item.json.stage_name }},"
                "{{ ($json.body && $json.body.reason) || $json.reason || '' }}"
            )},
        },
        (x, y + 120), type_version=2.5, credentials=pg_cred())
    nodes.append(on_reject); x += dx

    # Re-read artifact_json before returning to parent, so the parent's
    # query for stage 2 sees any clarification-round refinements made by
    # the backend (not the original Dify response).
    fetch_latest = node("Read latest artifact", "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": "SELECT artifact_json FROM pipeline_stage_status WHERE run_id=$1::uuid AND stage=$2",
            "options": {"queryReplacement": "={{ $('Start').item.json.run_id }},{{ $('Start').item.json.stage_name }}"},
        },
        (x, y - 120), type_version=2.5, credentials=pg_cred())
    nodes.append(fetch_latest)

    final_ok = node("Return artifact", "n8n-nodes-base.set",
        {
            "mode": "manual", "duplicateItem": False,
            "assignments": {"assignments": [
                {"id": nid(), "name": "stage",  "value": "={{ $('Start').item.json.stage_name }}", "type": "string"},
                {"id": nid(), "name": "status", "value": "approved", "type": "string"},
                {"id": nid(), "name": "parsed", "value": "={{ $('Read latest artifact').item.json.artifact_json.parsed }}", "type": "object"},
                {"id": nid(), "name": "answer", "value": "={{ $('Read latest artifact').item.json.artifact_json.answer }}", "type": "string"},
            ]},
            "options": {},
        },
        (x + dx, y - 120), type_version=3.4)
    nodes.append(final_ok)

    final_rejected = node("Return rejected", "n8n-nodes-base.set",
        {
            "mode": "manual", "duplicateItem": False,
            "assignments": {"assignments": [
                {"id": nid(), "name": "stage",  "value": "={{ $('Start').item.json.stage_name }}", "type": "string"},
                {"id": nid(), "name": "status", "value": "rejected", "type": "string"},
                {"id": nid(), "name": "reason", "value": "={{ ($('Approved?').item.json.body && $('Approved?').item.json.body.reason) || '' }}", "type": "string"},
            ]},
            "options": {},
        },
        (x + dx, y + 120), type_version=3.4)
    nodes.append(final_rejected)

    connections: dict = {}
    chain = [
        ("Start",               "Lookup Dify app key"),
        ("Lookup Dify app key", "Mark stage running"),
        ("Mark stage running",  "Call Dify"),
        ("Call Dify",           "Clean + parse"),
        ("Clean + parse",       "Write stage status"),
        ("Write stage status",  "Wait for approval"),
        ("Wait for approval",   "Approved?"),
    ]
    for src, dst in chain:
        connections[src] = {"main": [[{"node": dst, "type": "main", "index": 0}]]}

    connections["Approved?"] = {"main": [
        [{"node": "Mark approved", "type": "main", "index": 0}],
        [{"node": "Mark rejected", "type": "main", "index": 0}],
    ]}
    connections["Mark approved"]  = {"main": [[{"node": "Read latest artifact", "type": "main", "index": 0}]]}
    connections["Read latest artifact"] = {"main": [[{"node": "Return artifact", "type": "main", "index": 0}]]}
    connections["Mark rejected"]  = {"main": [[{"node": "Return rejected", "type": "main", "index": 0}]]}

    return {
        "name": "requirements_stage_template",
        "nodes": nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "staticData": None,
        "pinData": {},
        "meta": {"description": "Stage 1 only: Dify intake + clarification-aware status write + HITL wait. SharePoint upload deferred to backend."},
    }


# ============================================================
# sdlc_pipeline — parent
# ============================================================

def build_parent(stage_template_id: str, requirements_template_id: str | None = None) -> dict:
    """
    Parent flow:
      Webhook → Initialize run row → for each of 7 stages:
        Execute stage_template sub-workflow
        check status (if rejected, stop)
        feed parsed output into next stage's inputs
    Stage 1 uses requirements_stage_template (if provided); stages 2-7 use
    the generic stage_template.
    """
    nodes = []
    connections: dict = {}
    x = 240
    dx = 280
    y = 360

    # 1. Webhook trigger
    webhook = node(
        "Pipeline webhook",
        "n8n-nodes-base.webhook",
        {
            "httpMethod": "POST",
            "path": "pipeline/start",
            "responseMode": "responseNode",
            "options": {},
        },
        (x, y),
        type_version=2,
    )
    nodes.append(webhook); x += dx

    # 2. Postgres — INSERT pipeline_runs row (server-generated run_id)
    init_run = node(
        "Init pipeline_run",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": (
                "INSERT INTO pipeline_runs (repo_full_name, raw_request, requester_id, status, current_stage) "
                "VALUES ($1, $2, $3, 'running', 'requirements') "
                "RETURNING run_id"
            ),
            "options": {"queryReplacement": (
                "={{ $json.body.repo }},"
                "{{ $json.body.raw_request }},"
                "{{ $json.body.requester_id || 'unknown' }}"
            )},
        },
        (x, y),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(init_run); x += dx

    # 3. Acknowledge to caller (webhook responder) — return run_id immediately
    respond = node(
        "Respond run_id",
        "n8n-nodes-base.respondToWebhook",
        {
            "respondWith": "json",
            "responseBody": '={{ JSON.stringify({ run_id: $json.run_id }) }}',
            "options": {},
        },
        (x, y - 160),
        type_version=1.1,
    )
    nodes.append(respond)

    connections["Pipeline webhook"] = {"main": [[{"node": "Init pipeline_run", "type": "main", "index": 0}]]}
    connections["Init pipeline_run"] = {"main": [[{"node": "Respond run_id", "type": "main", "index": 0}, {"node": f"Stage 1 — {STAGES[0]}", "type": "main", "index": 0}]]}

    # Subsequent stages chain through Execute Workflow nodes
    prev = "Init pipeline_run"
    for i, stage in enumerate(STAGES, start=1):
        node_name = f"Stage {i} — {stage}"
        # Stage 1 routes to the dedicated requirements_stage_template when
        # the importer has resolved its id; stages 2-7 always use the generic
        # stage_template.
        workflow_target_id = requirements_template_id if (i == 1 and requirements_template_id) else stage_template_id
        exec_node = node(
            node_name,
            "n8n-nodes-base.executeWorkflow",
            {
                "source": "database",
                "workflowId": {"__rl": True, "value": workflow_target_id, "mode": "list"},
                "workflowInputs": {
                    "mappingMode": "defineBelow",
                    "value": {
                        "run_id": "={{ $('Init pipeline_run').item.json.run_id }}",
                        "stage_name": stage,
                        # For stage 1, query comes from webhook payload. For later stages, query is the previous stage's parsed JSON.
                        # design_preferences is forwarded via inputs (below) and the stage
                        # templates append it into the Dify query at call time.
                        "query": (
                            "={{ 'repo: ' + $('Pipeline webhook').item.json.body.repo + '\\nraw_request: ' + $('Pipeline webhook').item.json.body.raw_request }}"
                            if i == 1
                            else f"={{{{ JSON.stringify($('Stage {i-1} — {STAGES[i-2]}').item.json.parsed || {{}}) }}}}"
                        ),
                        # `design_preferences` is forwarded to every stage so
                        # the Dify prompts that consume it (1/4/6) can read
                        # from inputs.design_preferences uniformly. Stages
                        # that ignore it pay no cost.
                        "inputs": (
                            # Stage 6 (implementation): pass the full sprint plan
                            # + tech_stack from design, so the backend can
                            # orchestrate one PR per ticket and optionally scaffold.
                            "={{ ({ "
                            "repo_full_name: $('Pipeline webhook').item.json.body.repo, "
                            "sprint_json: JSON.stringify($('Stage 5 — sprint').item.json.parsed || {}), "
                            "design_excerpt: JSON.stringify($('Stage 4 — design').item.json.parsed || {}).slice(0, 5000), "
                            "tech_stack: JSON.stringify(($('Stage 4 — design').item.json.parsed || {}).tech_stack || {}), "
                            "design_preferences: JSON.stringify($('Pipeline webhook').item.json.body.design_preferences || null) "
                            "}) }}"
                            if i == 6
                            # Stage 7 (test): pass implementation artifact_url + branch_name for CI simulation
                            else "={{ ({ "
                            "repo_full_name: $('Pipeline webhook').item.json.body.repo, "
                            "implementation_summary: JSON.stringify($('Stage 6 — implementation').item.json.parsed || {}).slice(0, 2000), "
                            "design_preferences: JSON.stringify($('Pipeline webhook').item.json.body.design_preferences || null) "
                            "}) }}"
                            if i == 7
                            else "={{ ({ "
                            "repo_full_name: $('Pipeline webhook').item.json.body.repo, "
                            "design_preferences: JSON.stringify($('Pipeline webhook').item.json.body.design_preferences || null) "
                            "}) }}"
                        ),
                    },
                },
                "mode": "each",
                "options": {},
            },
            (x + i * dx, y + 160),
            type_version=1.2,
        )
        nodes.append(exec_node)
        # connect previous stage to this one (Stage 1 is connected from Init via the second outlet above)
        if i > 1:
            connections[f"Stage {i-1} — {STAGES[i-2]}"] = {"main": [[{"node": node_name, "type": "main", "index": 0}]]}

    # Final node — mark pipeline_runs completed
    finalize = node(
        "Mark completed",
        "n8n-nodes-base.postgres",
        {
            "operation": "executeQuery",
            "query": "UPDATE pipeline_runs SET status='completed', updated_at=now() WHERE run_id=$1::uuid",
            "options": {"queryReplacement": "={{ $('Init pipeline_run').item.json.run_id }}"},
        },
        (x + (len(STAGES) + 1) * dx, y + 160),
        type_version=2.5,
        credentials=pg_cred(),
    )
    nodes.append(finalize)
    connections[f"Stage {len(STAGES)} — {STAGES[-1]}"] = {"main": [[{"node": "Mark completed", "type": "main", "index": 0}]]}

    return {
        "name": "sdlc_pipeline",
        "nodes": nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "staticData": None,
        "pinData": {},
        "meta": {"description": "Parent SDLC pipeline: Webhook → 7 stage_template invocations → mark completed"},
    }


def main():
    stage_template = build_stage_template()
    out1 = HERE / "stage_template.json"
    out1.write_text(json.dumps(stage_template, indent=2))
    print(f"wrote {out1} ({len(stage_template['nodes'])} nodes)")

    req_template = build_requirements_stage_template()
    out_req = HERE / "requirements_stage_template.json"
    out_req.write_text(json.dumps(req_template, indent=2))
    print(f"wrote {out_req} ({len(req_template['nodes'])} nodes)")

    # Parent references both templates by id — we'll fix these after import.
    parent = build_parent(
        stage_template_id="__STAGE_TEMPLATE_ID__",
        requirements_template_id="__REQUIREMENTS_TEMPLATE_ID__",
    )
    out2 = HERE / "sdlc_pipeline.json"
    out2.write_text(json.dumps(parent, indent=2))
    print(f"wrote {out2} ({len(parent['nodes'])} nodes)")


if __name__ == "__main__":
    main()
