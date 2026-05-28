import { promises as fs } from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { githubService } from './githubService';
import { runImplementationTests, SandboxResult } from './sandboxRunnerService';
import { callAzureChat, callAgentChat, isAzureConfigured } from '../config/azure';
import { runAgentForTicket, type AgentPhase } from './claudeCodeAgentService';
import { runAzureAgentForTicket } from './openAICodeAgentService';

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});

const DIFY_URL = process.env.DIFY_BASE_URL || 'http://dify-nginx';
const MAX_ATTEMPTS = 3;

export interface FileChange {
    path: string;
    action: 'create' | 'modify' | 'delete';
    contents?: string;
    reason?: string;
}

export interface ImplementationJson {
    branch_name?: string;
    commit_message?: string;
    files_changed?: FileChange[];
    diff_summary?: string;
    test_files_added?: string[];
    self_review_notes?: string[];
    pr_title?: string;
    pr_body_markdown?: string;
}

export interface ValidationError {
    code: string;
    message: string;
    path?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface AttemptRecord {
    attempt: number;
    valid: boolean;
    errors: ValidationError[];
    branch_name?: string;
    files_count?: number;
    sandbox?: {
        ran: boolean;
        passed: boolean;
        language: string;
        test_count?: number;
        failure_count?: number;
        duration_ms: number;
        stdout_tail?: string;
        stderr_tail?: string;
        note?: string;
    };
}

export interface FinalizeResult {
    pr_url: string | null;
    pr_number: number | null;
    branch_name: string | null;
    attempts: number;
    attempt_history: AttemptRecord[];
    final_errors: ValidationError[];
    final_implementation_json: ImplementationJson | null;
}

/**
 * Validate an implementation JSON: structure, required fields, basic per-file syntax.
 * Conservative — only catches gross structural issues; deep static analysis would
 * require a per-language toolchain and is out of scope for this loop.
 */
export function validateImplementation(impl: ImplementationJson | null | undefined): ValidationResult {
    const errors: ValidationError[] = [];

    if (!impl || typeof impl !== 'object') {
        errors.push({ code: 'not_object', message: 'implementation must be a JSON object' });
        return { valid: false, errors };
    }
    if (!impl.branch_name || typeof impl.branch_name !== 'string') {
        errors.push({ code: 'missing_branch_name', message: 'branch_name is required and must be a string' });
    } else if (!/^[a-zA-Z0-9._/-]+$/.test(impl.branch_name)) {
        errors.push({ code: 'invalid_branch_name', message: `branch_name "${impl.branch_name}" contains invalid characters` });
    }
    if (!impl.commit_message || typeof impl.commit_message !== 'string') {
        errors.push({ code: 'missing_commit_message', message: 'commit_message is required' });
    }
    if (!Array.isArray(impl.files_changed) || impl.files_changed.length === 0) {
        errors.push({ code: 'no_files_changed', message: 'files_changed must be a non-empty array' });
    } else {
        impl.files_changed.forEach((f, i) => {
            if (!f.path || typeof f.path !== 'string') {
                errors.push({ code: 'file_missing_path', message: `files_changed[${i}] missing path` });
            }
            if (!f.action || !['create', 'modify', 'delete'].includes(f.action)) {
                errors.push({ code: 'file_invalid_action', message: `files_changed[${i}] action must be create|modify|delete`, path: f.path });
            }
            if (f.action !== 'delete' && (!f.contents || typeof f.contents !== 'string')) {
                errors.push({ code: 'file_missing_contents', message: `files_changed[${i}] (${f.path}) missing contents`, path: f.path });
            }
            // Lightweight per-extension syntax check
            if (f.path && f.contents) {
                if (f.path.endsWith('.json')) {
                    try { JSON.parse(f.contents); } catch (e) {
                        errors.push({ code: 'invalid_json', message: `${f.path}: ${(e as Error).message}`, path: f.path });
                    }
                }
                // YAML, SQL, TS etc. would need real parsers; skip for now.
            }
        });
    }
    // Require at least one test file to enforce TDD-ish discipline
    const hasTestInChanges = (impl.files_changed || []).some(f => /test|spec|__tests__/i.test(f.path || ''));
    const hasTestInList = Array.isArray(impl.test_files_added) && impl.test_files_added.length > 0;
    if (!hasTestInChanges && !hasTestInList) {
        errors.push({ code: 'no_tests', message: 'implementation must include at least one test file (path containing test/spec, or list in test_files_added)' });
    }
    if (!impl.pr_title || typeof impl.pr_title !== 'string') {
        errors.push({ code: 'missing_pr_title', message: 'pr_title is required' });
    }

    return { valid: errors.length === 0, errors };
}

async function getDifyKeyForImplementation(): Promise<{ app_id: string; api_key: string }> {
    const result = await pool.query<{ app_id: string; api_key: string }>(
        'SELECT app_id, api_key FROM dify_app_keys WHERE stage = $1',
        ['implementation']
    );
    if (result.rows.length === 0) {
        throw new Error('No dify_app_keys row for stage=implementation');
    }
    return result.rows[0];
}

interface DifyCallParams {
    repo: string;
    ticket: unknown;
    designExcerpt: unknown;
    previousAttempt?: ImplementationJson | null;
    previousErrors?: ValidationError[];
}

async function callDifyForImplementation(params: DifyCallParams): Promise<ImplementationJson> {
    const { api_key } = await getDifyKeyForImplementation();

    const ticketStr = typeof params.ticket === 'string' ? params.ticket : JSON.stringify(params.ticket);
    const designStr = typeof params.designExcerpt === 'string' ? params.designExcerpt : JSON.stringify(params.designExcerpt);

    const inputs: Record<string, string> = {
        repo_full_name: params.repo,
        ticket: ticketStr,
        design_excerpt: designStr.slice(0, 3000),
    };

    // Build the query: on first attempt, just hand off the ticket. On retry,
    // feed back the validation errors so Dify can self-correct.
    let query: string;
    if (params.previousErrors && params.previousErrors.length > 0) {
        const errLines = params.previousErrors.map(e => `- [${e.code}] ${e.message}${e.path ? ` (file: ${e.path})` : ''}`).join('\n');
        const prevSummary = params.previousAttempt
            ? `Previous attempt branch_name="${params.previousAttempt.branch_name}", files_changed=${(params.previousAttempt.files_changed || []).length}.`
            : 'Previous attempt could not be parsed.';
        query = `Previous implementation attempt FAILED validation. ${prevSummary}\n\nErrors to fix:\n${errLines}\n\nProduce a corrected implementation. Same JSON schema. Address every error above. Include at least one test file covering the acceptance criteria.`;
    } else {
        query = `Implement ticket: ${ticketStr}`;
    }

    const body = {
        inputs,
        query,
        response_mode: 'blocking',
        user: `backend-agent-${Date.now()}`,
    };

    const resp = await fetch(`${DIFY_URL}/v1/chat-messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${api_key}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Dify call failed (${resp.status}): ${errText.slice(0, 300)}`);
    }
    const data = await resp.json() as { answer?: string };
    let answer = (data.answer || '').toString();
    // Strip DeepSeek <think> blocks and markdown fences just in case
    answer = answer.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    answer = answer.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    try {
        return JSON.parse(answer) as ImplementationJson;
    } catch (e) {
        // Show the tail too — most truncation failures cut off near the end,
        // and the parse error position there is what tells us if max_tokens
        // ran out vs a malformed escape somewhere in the middle.
        const head = answer.slice(0, 1500);
        const tail = answer.length > 1500 ? `\n...[${answer.length - 1500 - 800} chars omitted]...\n${answer.slice(-800)}` : '';
        const err = new Error(`Dify returned non-JSON (len=${answer.length}, parse error: ${(e as Error).message}): ${head}${tail}`);
        (err as Error & { rawAnswer?: string }).rawAnswer = answer;
        throw err;
    }
}

/**
 * Persist a partial snapshot of the agent loop into pipeline_stage_status so the
 * frontend SSE stream can show progress live (validating → retrying → PR open).
 * Best-effort: if the UPDATE fails (e.g. no run_id was passed in), swallow the
 * error so it never blocks the loop.
 */
type AgentStatus =
    | 'calling_dify'
    | 'calling_agent'
    | 'agent:exploring'
    | 'agent:writing'
    | 'agent:testing'
    | 'agent:fixing'
    | 'agent:finishing'
    | 'validating'
    | 'sandbox:install'
    | 'sandbox:typecheck'
    | 'sandbox:build'
    | 'sandbox:test'
    | 'sandbox:smoke'
    | 'retrying'
    | 'creating_pr'
    | 'done'
    | 'failed';

async function pushAgentProgress(
    runId: string | null | undefined,
    payload: {
        status: AgentStatus;
        attempts: number;
        attempt_history: AttemptRecord[];
        current_impl: ImplementationJson | null;
        pr_url?: string | null;
        pr_number?: number | null;
        branch_name?: string | null;
        final_errors?: ValidationError[];
        current_turn?: number;
        max_turns?: number;
    },
): Promise<void> {
    if (!runId) return;
    const agentBlob = {
        status: payload.status,
        attempts: payload.attempts,
        attempt_history: payload.attempt_history,
        pr_url: payload.pr_url ?? null,
        pr_number: payload.pr_number ?? null,
        branch_name: payload.branch_name ?? payload.current_impl?.branch_name ?? null,
        final_errors: payload.final_errors ?? [],
        current_turn: payload.current_turn ?? null,
        max_turns: payload.max_turns ?? null,
    };
    try {
        await pool.query(
            `UPDATE pipeline_stage_status
               SET artifact_json = COALESCE(artifact_json, '{}'::jsonb)
                                 || jsonb_build_object('agent', $3::jsonb,
                                                       'parsed', COALESCE($4::jsonb, COALESCE(artifact_json, '{}'::jsonb)->'parsed'))
             WHERE run_id = $1::uuid AND stage = $2`,
            [runId, 'implementation', JSON.stringify(agentBlob), payload.current_impl ? JSON.stringify(payload.current_impl) : null],
        );
    } catch (e) {
        console.warn('[agent] failed to push progress for run', runId, e);
    }
}

/**
 * Run the agent loop: validate the initial implementation, retry via Dify with
 * error feedback up to MAX_ATTEMPTS, then create the PR on success.
 *
 * If runId is provided, intermediate progress is written back to
 * pipeline_stage_status.artifact_json so the frontend SSE stream can show the
 * loop in real time.
 */
export async function finalizeImplementation(
    repo: string,
    ticket: unknown,
    designExcerpt: unknown,
    initialImpl: ImplementationJson | null,
    runId: string | null = null,
    opts: { baseBranch?: string; existingTree?: Record<string, string>; skipPR?: boolean } = {},
): Promise<FinalizeResult> {
    const history: AttemptRecord[] = [];
    let current: ImplementationJson | null = initialImpl;

    // Priority: Azure GPT agent → Claude agent → Dify (one-shot fallback)
    const useAzureAgent  = isAzureConfigured();
    const useClaudeAgent = !!(process.env.ANTHROPIC_API_KEY);
    const useAgent       = useAzureAgent || useClaudeAgent;

    const PHASE_TO_STATUS: Record<AgentPhase, AgentStatus> = {
        exploring: 'agent:exploring',
        writing:   'agent:writing',
        testing:   'agent:testing',
        fixing:    'agent:fixing',
        finishing: 'agent:finishing',
    };
    const maxTurns = parseInt(process.env.AGENT_MAX_TURNS || '35', 10);
    const onProgress = async (turn: number, agentPhase: AgentPhase) => {
        await pushAgentProgress(runId, {
            status: PHASE_TO_STATUS[agentPhase] ?? 'calling_agent',
            attempts: 1,
            attempt_history: history,
            current_impl: null,
            current_turn: turn,
            max_turns: maxTurns,
        });
    };

    // When called from implementSprint, initialImpl is null. Generate the first
    // implementation via the agentic loop or Dify fallback.
    if (!current) {
        await pushAgentProgress(runId, {
            status: useAgent ? 'calling_agent' : 'calling_dify',
            attempts: 1,
            attempt_history: history,
            current_impl: null,
        });

        const agentOpts = {
            onProgress,
            liveLogPath: runId ? `/app/deployments/${runId}/sandbox.log` : undefined,
        };

        try {
            if (useAzureAgent) {
                current = await runAzureAgentForTicket(repo, ticket, designExcerpt, opts.existingTree ?? {}, runId, agentOpts);
            } else if (useClaudeAgent) {
                current = await runAgentForTicket(repo, ticket, designExcerpt, opts.existingTree ?? {}, runId, agentOpts);
            } else {
                current = await callDifyForImplementation({ repo, ticket, designExcerpt });
            }
        } catch (e) {
            const code = useAgent ? 'agent_call_failed' : 'dify_call_failed';
            const msg = (e as Error).message;
            history.push({ attempt: 1, valid: false, errors: [{ code, message: msg }] });

            // If retries remain, re-run immediately with the failure as context
            // so the agent knows to skip exploration and write files right away.
            if (useAgent && MAX_ATTEMPTS > 1) {
                const retryOpts = {
                    onProgress,
                    liveLogPath: runId ? `/app/deployments/${runId}/sandbox.log` : undefined,
                    systemPromptSuffix:
                        `## RETRY — Attempt 1 failed\n` +
                        `- [${code}] ${msg.slice(0, 400)}\n\n` +
                        `Do NOT re-explore. Skip straight to writing files.`,
                };
                await pushAgentProgress(runId, { status: 'calling_agent', attempts: 2, attempt_history: history, current_impl: null });
                try {
                    if (useAzureAgent) {
                        current = await runAzureAgentForTicket(repo, ticket, designExcerpt, opts.existingTree ?? {}, runId, retryOpts);
                    } else {
                        current = await runAgentForTicket(repo, ticket, designExcerpt, opts.existingTree ?? {}, runId, retryOpts);
                    }
                } catch (e2) {
                    const msg2 = (e2 as Error).message;
                    history.push({ attempt: 2, valid: false, errors: [{ code, message: msg2 }] });
                    return {
                        pr_url: null, pr_number: null, branch_name: null,
                        attempts: 2, attempt_history: history,
                        final_errors: [{ code, message: msg2 }],
                        final_implementation_json: null,
                    };
                }
                // current is now set — fall through to the validation loop
            } else {
                return {
                    pr_url: null, pr_number: null, branch_name: null,
                    attempts: 1, attempt_history: history,
                    final_errors: [{ code, message: msg }],
                    final_implementation_json: null,
                };
            }
        }
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await pushAgentProgress(runId, {
            status: 'validating',
            attempts: attempt,
            attempt_history: history,
            current_impl: current,
        });
        const validation = validateImplementation(current);

        // If structure validates, also try to actually run the unit tests in a
        // sandbox. A failing test run is treated as another validation error so
        // Dify gets feedback and can self-correct.
        let sandbox: SandboxResult | null = null;
        const sandboxErrors: ValidationError[] = [];
        if (validation.valid && current) {
            try {
                sandbox = await runImplementationTests(current, {
                    runId: runId ?? undefined,
                    attempt,
                    // existingTree lets multi-ticket sprints test against the
                    // accumulated state from earlier tickets, not just this
                    // ticket's files in isolation.
                    existingTree: opts.existingTree,
                    // Live sandbox stdout streams into this file; the UI polls
                    // /api/pipelines/:run_id/sandbox-logs to render it.
                    liveLogPath: runId ? `/app/deployments/${runId}/sandbox.log` : undefined,
                    onGate: async (gate) => {
                        await pushAgentProgress(runId, {
                            status: `sandbox:${gate}` as AgentStatus,
                            attempts: attempt,
                            attempt_history: history,
                            current_impl: current,
                        });
                    },
                });
                if (sandbox.ran && !sandbox.passed) {
                    // Pick the first failed gate so the retry-prompt tells the agent
                    // *which* check failed (install vs typecheck vs build vs test).
                    // Lumping everything under `sandbox_tests_failed` made the agent
                    // try to "fix the failing test" when the real problem was a
                    // hallucinated npm dep that broke `npm install`.
                    const firstFailedGate = (sandbox.gates || []).find(g => !g.passed);
                    const gateName = firstFailedGate?.name || 'unknown';
                    const code = /install/.test(gateName) ? 'sandbox_install_failed'
                        : /tsc|typecheck/.test(gateName) ? 'sandbox_typecheck_failed'
                        : /build/.test(gateName) ? 'sandbox_build_failed'
                        : /smoke|start/.test(gateName) ? 'sandbox_runtime_failed'
                        : 'sandbox_tests_failed';
                    // Always include stderr — npm sends most install errors there,
                    // and the old `stdout || stderr` short-circuited past it when
                    // stdout was just the gate header.
                    const stdoutBlock = sandbox.stdout ? `\n--- stdout ---\n${sandbox.stdout}` : '';
                    const stderrBlock = sandbox.stderr ? `\n--- stderr ---\n${sandbox.stderr}` : '';
                    const body = stdoutBlock + stderrBlock || '\n(no output captured)';
                    const summary = code === 'sandbox_tests_failed'
                        ? `Unit tests failed (${sandbox.failure_count ?? '?'}/${sandbox.test_count ?? '?'} failures)`
                        : `Sandbox gate "${gateName}" failed (exit=${firstFailedGate?.exit_code ?? '?'})`;
                    sandboxErrors.push({
                        code,
                        message: `${summary}.${body}`,
                    });
                }
            } catch (e) {
                console.warn('[agent] sandbox runner crashed:', e);
            }
        }

        const attemptValid = validation.valid && sandboxErrors.length === 0;
        const attemptErrors = [...validation.errors, ...sandboxErrors];

        history.push({
            attempt,
            valid: attemptValid,
            errors: attemptErrors,
            branch_name: current?.branch_name,
            files_count: current?.files_changed?.length,
            sandbox: sandbox ? {
                ran: sandbox.ran,
                passed: sandbox.passed,
                language: sandbox.language,
                test_count: sandbox.test_count,
                failure_count: sandbox.failure_count,
                duration_ms: sandbox.duration_ms,
                stdout_tail: sandbox.stdout ? sandbox.stdout.slice(-800) : undefined,
                stderr_tail: sandbox.stderr ? sandbox.stderr.slice(-800) : undefined,
                note: sandbox.note,
            } : undefined,
        });

        if (attemptValid) {
            // If PR creation is deferred (default for "ask before create" flow),
            // return the validated implementation immediately so the orchestrator
            // can store it and the user can opt in later.
            if (opts.skipPR) {
                await pushAgentProgress(runId, {
                    status: 'done',
                    attempts: attempt,
                    attempt_history: history,
                    current_impl: current,
                    pr_url: null,
                    pr_number: null,
                    branch_name: current!.branch_name || null,
                });
                return {
                    pr_url: null,
                    pr_number: null,
                    branch_name: current!.branch_name || null,
                    attempts: attempt,
                    attempt_history: history,
                    final_errors: [],
                    final_implementation_json: current,
                };
            }
            await pushAgentProgress(runId, {
                status: 'creating_pr',
                attempts: attempt,
                attempt_history: history,
                current_impl: current,
            });
            // Create the PR and exit
            const pat = process.env.GITHUB_PAT;
            if (!pat) {
                return {
                    pr_url: null,
                    pr_number: null,
                    branch_name: current!.branch_name || null,
                    attempts: attempt,
                    attempt_history: history,
                    final_errors: [{ code: 'no_github_pat', message: 'GITHUB_PAT not configured' }],
                    final_implementation_json: current,
                };
            }
            const [owner, repoName] = repo.split('/');
            if (!owner || !repoName) {
                return {
                    pr_url: null,
                    pr_number: null,
                    branch_name: current!.branch_name || null,
                    attempts: attempt,
                    attempt_history: history,
                    final_errors: [{ code: 'invalid_repo', message: `repo "${repo}" must be owner/name` }],
                    final_implementation_json: current,
                };
            }
            try {
                const pr = await githubService.createBranchAndPR(pat, owner, repoName, {
                    branchName: current!.branch_name!,
                    commitMessage: current!.commit_message || 'feat: agentic implementation',
                    filesChanged: current!.files_changed || [],
                    prTitle: current!.pr_title || current!.branch_name!,
                    prBody: current!.pr_body_markdown || '',
                    baseBranch: opts.baseBranch,
                });
                console.log(`[agent] PR #${pr.prNumber} created for ${repo} on attempt ${attempt}: ${pr.prUrl}`);
                await pushAgentProgress(runId, {
                    status: 'done',
                    attempts: attempt,
                    attempt_history: history,
                    current_impl: current,
                    pr_url: pr.prUrl,
                    pr_number: pr.prNumber,
                    branch_name: pr.branchName,
                });
                return {
                    pr_url: pr.prUrl,
                    pr_number: pr.prNumber,
                    branch_name: pr.branchName,
                    attempts: attempt,
                    attempt_history: history,
                    final_errors: [],
                    final_implementation_json: current,
                };
            } catch (e) {
                return {
                    pr_url: null,
                    pr_number: null,
                    branch_name: current!.branch_name || null,
                    attempts: attempt,
                    attempt_history: history,
                    final_errors: [{ code: 'pr_creation_failed', message: (e as Error).message }],
                    final_implementation_json: current,
                };
            }
        }

        // Not valid — retry if attempts remain.
        if (attempt < MAX_ATTEMPTS) {
            await pushAgentProgress(runId, {
                status: 'retrying',
                attempts: attempt,
                attempt_history: history,
                current_impl: current,
            });

            if (useAgent) {
                // Re-run the agent with the failed files as context and the
                // sandbox/validation errors injected via systemPromptSuffix so
                // it knows exactly what to fix on the second pass.
                console.log(`[agent] Agent attempt ${attempt} failed (${attemptErrors.length} errors) — re-running agent with error context`);

                // Merge the existing tree with files the agent already wrote so
                // the retry starts from the current state, not a blank slate.
                const retryTree: Record<string, string> = { ...(opts.existingTree ?? {}) };
                for (const f of (current?.files_changed ?? [])) {
                    if ((f.action === 'create' || f.action === 'modify') && f.contents) {
                        retryTree[f.path] = f.contents;
                    } else if (f.action === 'delete') {
                        delete retryTree[f.path];
                    }
                }

                const errorSummary = attemptErrors
                    .map(e => `- [${e.code}] ${e.message.slice(0, 600)}`)
                    .join('\n');
                const retryOpts = {
                    onProgress,
                    liveLogPath: runId ? `/app/deployments/${runId}/sandbox.log` : undefined,
                    systemPromptSuffix: `## RETRY — Previous attempt failed\nFix the errors below. Do NOT rewrite files that are already correct.\n\n${errorSummary}`,
                };

                await pushAgentProgress(runId, {
                    status: 'calling_agent',
                    attempts: attempt + 1,
                    attempt_history: history,
                    current_impl: current,
                });

                try {
                    if (useAzureAgent) {
                        current = await runAzureAgentForTicket(repo, ticket, designExcerpt, retryTree, runId, retryOpts);
                    } else {
                        current = await runAgentForTicket(repo, ticket, designExcerpt, retryTree, runId, retryOpts);
                    }
                } catch (e) {
                    const code = 'agent_call_failed';
                    history.push({ attempt: attempt + 1, valid: false, errors: [{ code, message: (e as Error).message }] });
                    return {
                        pr_url: null, pr_number: null, branch_name: null,
                        attempts: attempt + 1, attempt_history: history,
                        final_errors: [{ code, message: (e as Error).message }],
                        final_implementation_json: current,
                    };
                }
            } else {
                console.log(`[agent] Attempt ${attempt} failed (${attemptErrors.length} errors, sandbox ran=${sandbox?.ran ?? false} passed=${sandbox?.passed ?? false}), asking Dify to retry...`);
                await pushAgentProgress(runId, {
                    status: 'calling_dify',
                    attempts: attempt + 1,
                    attempt_history: history,
                    current_impl: current,
                });
                try {
                    current = await callDifyForImplementation({
                        repo,
                        ticket,
                        designExcerpt,
                        previousAttempt: current,
                        previousErrors: attemptErrors,
                    });
                } catch (e) {
                    history.push({ attempt: attempt + 1, valid: false, errors: [{ code: 'dify_call_failed', message: (e as Error).message }] });
                    return {
                        pr_url: null,
                        pr_number: null,
                        branch_name: null,
                        attempts: attempt + 1,
                        attempt_history: history,
                        final_errors: [{ code: 'dify_call_failed', message: (e as Error).message }],
                        final_implementation_json: current,
                    };
                }
            }
        }
    }

    // Exhausted all attempts without a valid implementation
    const lastErrors = history[history.length - 1]?.errors || [];
    return {
        pr_url: null,
        pr_number: null,
        branch_name: current?.branch_name || null,
        attempts: MAX_ATTEMPTS,
        attempt_history: history,
        final_errors: lastErrors,
        final_implementation_json: current,
    };
}

// ─── Multi-ticket sprint orchestration ───────────────────────────────────────

export interface SprintTicket {
    id: string;
    title: string;
    description?: string;
    acceptance_criteria?: string[];
    files_likely_touched?: string[];
    estimate_points?: number;
    dependencies?: string[];   // ids of tickets that must merge first
    sprint_assignment?: number;
}

export interface TicketOutcome {
    ticket_id: string;
    title: string;
    pr_url: string | null;
    pr_number: number | null;
    branch_name: string | null;
    base_branch: string | null;
    attempts: number;
    final_errors: ValidationError[];
    skipped?: string; // present when we couldn't process this ticket (e.g. blocked dependency)
    /** Validated implementation files; retained so a later "Create PRs" action
     *  can push to GitHub without re-running the agent. Null for skipped tickets. */
    implementation_json?: ImplementationJson | null;
    /** Original ticket payload — needed for PR title/body and as Dify input on re-attempts. */
    ticket_payload?: unknown;
}

export interface SprintResult {
    pr_urls: string[];
    outcomes: TicketOutcome[];
    skipped_count: number;
    failed_count: number;
    succeeded_count: number;
}

/**
 * Kahn's algorithm — order tickets so dependencies always precede dependents.
 * Tickets referring to unknown ids are kept in their declared position (we
 * don't reject them; the agent may have referenced a ticket from a previous
 * sprint that's already shipped).
 */
function topoSortTickets(tickets: SprintTicket[]): SprintTicket[] {
    const known = new Set(tickets.map(t => t.id));
    const indegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const t of tickets) {
        indegree.set(t.id, 0);
        adj.set(t.id, []);
    }
    for (const t of tickets) {
        for (const dep of t.dependencies || []) {
            if (!known.has(dep)) continue; // external dep, ignore for ordering
            adj.get(dep)!.push(t.id);
            indegree.set(t.id, (indegree.get(t.id) || 0) + 1);
        }
    }

    const byId = new Map(tickets.map(t => [t.id, t]));
    const ordered: SprintTicket[] = [];
    // Start with sprint_assignment then estimate_points then id as a tie-break
    const ready: string[] = Array.from(indegree.entries())
        .filter(([, n]) => n === 0)
        .map(([id]) => id)
        .sort((a, b) => {
            const ta = byId.get(a)!;
            const tb = byId.get(b)!;
            return (ta.sprint_assignment ?? 0) - (tb.sprint_assignment ?? 0)
                || (ta.estimate_points ?? 0) - (tb.estimate_points ?? 0)
                || a.localeCompare(b);
        });

    while (ready.length > 0) {
        const id = ready.shift()!;
        ordered.push(byId.get(id)!);
        for (const next of adj.get(id) || []) {
            const n = (indegree.get(next) || 0) - 1;
            indegree.set(next, n);
            if (n === 0) ready.push(next);
        }
    }

    // Anything left has a dependency cycle — append in declared order so we
    // don't silently drop tickets. The per-ticket validator will likely fail
    // them, which is the correct signal.
    for (const t of tickets) {
        if (!ordered.find(o => o.id === t.id)) ordered.push(t);
    }
    return ordered;
}

async function pushSprintProgress(
    runId: string | null,
    outcomes: TicketOutcome[],
    currentTicket: { id: string; index: number; total: number; status: string } | null,
): Promise<void> {
    if (!runId) return;
    const sprintBlob = {
        kind: 'sprint',
        current_ticket: currentTicket,
        outcomes,
        succeeded: outcomes.filter(o => o.pr_url).length,
        failed: outcomes.filter(o => !o.pr_url && !o.skipped).length,
        skipped: outcomes.filter(o => o.skipped).length,
    };
    try {
        await pool.query(
            `UPDATE pipeline_stage_status
               SET artifact_json = COALESCE(artifact_json, '{}'::jsonb)
                                 || jsonb_build_object('sprint', $3::jsonb)
             WHERE run_id = $1::uuid AND stage = $2`,
            [runId, 'implementation', JSON.stringify(sprintBlob)],
        );
    } catch (e) {
        console.warn('[agent] failed to push sprint progress', e);
    }
}

/**
 * Build code for an entire sprint: one ticket at a time, in topological order,
 * each ticket producing its own draft PR. Subsequent tickets are tested
 * against the accumulated file state from prior tickets so cross-file
 * integration is exercised.
 *
 * Branch strategy: every ticket gets its own branch off `mainBase` (default
 * branch by default). The branches are NOT stacked on each other — reviewers
 * land them independently. The sandbox simulates the cumulative state in tmp.
 * If a ticket's PR can't be opened, dependents are still attempted (their
 * sandbox just won't have the failing ticket's files), so the reviewer can
 * see exactly which ones broke.
 */
// Paths owned by the scaffold service. If a sprint ticket's title or
// files_likely_touched list points at these, the ticket is duplicating
// scaffold work — skip it instead of opening a redundant PR.
const SCAFFOLD_OWNED_FILES = new Set([
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'tsconfig.json', 'next.config.mjs', 'next.config.js',
    'tailwind.config.ts', 'postcss.config.mjs',
    'vitest.config.ts', 'vitest.setup.ts',
    '.eslintrc.json', 'pyproject.toml', 'requirements.txt',
]);
const SCAFFOLD_TITLE_RE = /^\s*(scaffold|bootstrap|initialize)\b.*\b(next\.?js|app|project|repo|monorepo|workspace|template)/i;

function isScaffoldTicket(t: SprintTicket): string | null {
    if (SCAFFOLD_TITLE_RE.test(t.title)) {
        return `title "${t.title}" looks like scaffolding`;
    }
    const touched = (t.files_likely_touched || []).map(p => p.split('/').pop() || p);
    const scaffoldHits = touched.filter(f => SCAFFOLD_OWNED_FILES.has(f));
    if (scaffoldHits.length > 0 && scaffoldHits.length >= touched.length / 2) {
        return `files_likely_touched dominated by scaffold-owned files: ${scaffoldHits.join(', ')}`;
    }
    return null;
}

const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/app/templates';

/**
 * After a sprint finishes, persist the accumulated file tree (optionally
 * layered on top of a scaffold template) to /app/deployments/{runId}/source/.
 * The deploy service reads from here to spawn the running app. Best-effort —
 * if persistence fails we log but do not fail the sprint.
 */

async function buildEntryPage(
    accumulatedTree: Record<string, string>,
    implFiles: string[],
): Promise<string> {
    // Only attempt AI page generation if Azure is configured
    if (isAzureConfigured()) {
        try {
            const KEY_EXTS = ['.tsx', '.ts', '.jsx', '.js'];
            const SKIP_PATTERNS = ['test', 'spec', 'vitest', '__', 'conftest', '.config.'];
            const codeFiles = implFiles
                .filter(f => KEY_EXTS.some(e => f.endsWith(e)) && !SKIP_PATTERNS.some(p => f.includes(p)))
                .slice(0, 12);

            const fileSnippets = codeFiles.map(f => {
                const content = accumulatedTree[f] ?? '';
                return `### ${f}\n\`\`\`tsx\n${content.slice(0, 1200)}\n\`\`\``;
            }).join('\n\n');

            // Classify files so the prompt can give appropriate guidance
            const hasComponents = codeFiles.some(f => f.endsWith('.tsx') || f.endsWith('.jsx'));
            const hasHooks = codeFiles.some(f => f.includes('/hooks/') || f.includes('use-'));
            const isUtilityOnly = !hasComponents && !hasHooks;

            const renderHint = isUtilityOnly
                ? `These files contain domain models, utility functions, and/or data — no React components. ` +
                  `Create an interactive demo page that imports and CALLS the utility functions/schemas with example data, ` +
                  `showing the output on screen (e.g. a unit conversion tool, a schema validation demo, a data browser). ` +
                  `Use useState/useEffect freely since you must add 'use client'.`
                : hasComponents
                    ? `Import and compose the React components into a complete, visually rich app page.`
                    : `Import and use the hooks/stores with demo UI to show the feature working end-to-end.`;

            const systemPrompt = `You are a senior Next.js developer. Generate a complete, working \`src/app/page.tsx\` for a deployed preview.

Rules:
- Add 'use client' at the top (always — the page uses state/effects)
- ${renderHint}
- Import from the implemented files using @/ alias (e.g. import { foo } from '@/lib/units')
- Make the page visually useful — show real functionality, not just a title
- Use inline Tailwind classes (className="...") for styling
- Output ONLY the TypeScript/TSX code, no markdown fences, no explanation
- The file MUST contain 'export default function'`;

            const userPrompt = `Implemented files:\n\n${fileSnippets}\n\nGenerate the complete src/app/page.tsx now:`;

            const raw = await callAgentChat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ], 0.2);

            // Strip any accidental markdown fences
            const cleaned = raw
                .replace(/^```(?:tsx?|jsx?|typescript)?\s*/i, '')
                .replace(/\s*```\s*$/i, '')
                .trim();

            if (cleaned.length > 100 && (cleaned.includes('export default') || cleaned.includes('export function'))) {
                console.log(`[persistSourceForDeploy] AI generated page.tsx (${cleaned.length} chars)`);
                return cleaned;
            }
            console.warn(`[persistSourceForDeploy] AI page.tsx rejected (len=${cleaned.length}, hasExport=${cleaned.includes('export default')})`);
        } catch (e) {
            console.warn('[persistSourceForDeploy] AI page generation failed, using static fallback:', e);
        }
    }

    // Fallback: static summary page
    const byDir: Record<string, string[]> = {};
    for (const f of implFiles) {
        const dir = f.split('/').slice(0, -1).join('/') || '.';
        (byDir[dir] ??= []).push(f.split('/').pop()!);
    }
    const sections = Object.entries(byDir).map(([dir, files]) =>
        `      <li><strong>${dir}/</strong><ul>${files.map(f => `<li>${f}</li>`).join('')}</ul></li>`
    ).join('\n');
    return `export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '60px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Implementation deployed</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>
        The following files were generated by the SDLC pipeline and are live in this build.
      </p>
      <ul style={{ lineHeight: 2 }}>
${sections}
      </ul>
    </main>
  );
}
`;
}

async function persistSourceForDeploy(
    runId: string | null,
    accumulatedTree: Record<string, string>,
    templateId?: string | null,
): Promise<void> {
    if (!runId) return;
    if (Object.keys(accumulatedTree).length === 0 && !templateId) return;
    const sourceDir = path.join(DEPLOYMENTS_ROOT, runId, 'source');
    try {
        await fs.mkdir(sourceDir, { recursive: true });

        // Lay down template files first (when known) so accumulated impl
        // overrides them where the agent edited shared files like package.json.
        if (templateId) {
            const tmplRoot = path.join(TEMPLATES_DIR, templateId.replace(/^templates\//, ''));
            try {
                await copyTemplateTree(tmplRoot, sourceDir);
            } catch (e) {
                console.warn(`[persistSourceForDeploy] could not copy template ${templateId}:`, e);
            }
        }

        for (const [rel, contents] of Object.entries(accumulatedTree)) {
            const full = path.join(sourceDir, rel);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, contents, 'utf8');
        }

        // Ensure there is a root page (app/page.tsx or src/app/page.tsx) so the deployed
        // app doesn't show a 404 at "/". Try both Next.js App Router conventions.
        const rootPageCandidates = ['src/app/page.tsx', 'app/page.tsx'];
        const isPlaceholder = (content: string) =>
            content.includes('Implementation deployed') ||
            content.includes('Feature implementation lands in the next PR') ||
            content.trim().length < 100;

        let rootPageKey = rootPageCandidates.find(k => accumulatedTree[k]);

        // Check if the root page (whether from accumulatedTree or on disk) is a placeholder
        if (rootPageKey) {
            // Sprint wrote a root page — check if it's still the scaffold placeholder
            if (isPlaceholder(accumulatedTree[rootPageKey])) {
                const implFiles = Object.keys(accumulatedTree).filter(k => !k.includes('test') && !k.includes('spec'));
                console.log(`[persistSourceForDeploy] sprint root page is placeholder — regenerating with AI…`);
                const generatedPage = await buildEntryPage(accumulatedTree, implFiles);
                const fullPath = path.join(sourceDir, rootPageKey);
                await fs.writeFile(fullPath, generatedPage, 'utf8');
            }
        } else {
            // Sprint did not write a root page — check what exists on disk
            for (const candidate of rootPageCandidates) {
                const onDisk = await fs.readFile(path.join(sourceDir, candidate), 'utf8').catch(() => null);
                if (onDisk !== null) {
                    rootPageKey = candidate;
                    if (isPlaceholder(onDisk)) {
                        const implFiles = Object.keys(accumulatedTree).filter(k => !k.includes('test') && !k.includes('spec'));
                        console.log(`[persistSourceForDeploy] disk root page is placeholder — regenerating with AI…`);
                        const generatedPage = await buildEntryPage(accumulatedTree, implFiles);
                        await fs.writeFile(path.join(sourceDir, candidate), generatedPage, 'utf8');
                    }
                    break;
                }
            }
        }
        if (!rootPageKey) {
            // No root page exists anywhere — generate one from scratch
            // Determine whether to use src/app or app by looking at file structure
            const usesSrcApp = Object.keys(accumulatedTree).some(k => k.startsWith('src/app/') || k.startsWith('src/'));
            const targetKey = usesSrcApp ? 'src/app/page.tsx' : 'app/page.tsx';
            const implFiles = Object.keys(accumulatedTree).filter(k => !k.includes('test') && !k.includes('spec'));
            console.log(`[persistSourceForDeploy] no root page found — generating entry page at ${targetKey}…`);
            const generatedPage = await buildEntryPage(accumulatedTree, implFiles);
            const fullPath = path.join(sourceDir, targetKey);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, generatedPage, 'utf8');
        }

        // Generate Dockerfile(s) using AI after all source files are written
        await generateDockerfilesForSource(sourceDir, accumulatedTree);

        console.log(`[persistSourceForDeploy] wrote ${Object.keys(accumulatedTree).length} impl files + template "${templateId ?? 'none'}" to ${sourceDir}`);
    } catch (e) {
        console.warn(`[persistSourceForDeploy] failed for ${runId}:`, e);
    }
}

async function generateDockerfilesForSource(
    sourceDir: string,
    accumulatedTree: Record<string, string>,
): Promise<void> {
    // Skip if Dockerfile(s) already provided by the implementation agent
    const hasDockerfile = Object.keys(accumulatedTree).some(k => k.toLowerCase().includes('dockerfile'));
    if (hasDockerfile) {
        console.log('[persistSourceForDeploy] Dockerfile(s) already in implementation output — skipping AI generation');
        return;
    }

    if (!isAzureConfigured()) return;

    // Scan actual disk files (includes template files, not just accumulatedTree)
    const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '__pycache__', '.venv', 'coverage']);
    const scanDir = async (dir: string, rel = '', d = 0): Promise<string[]> => {
        if (d > 4) return [];
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const out: string[] = [];
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) out.push(...await scanDir(path.join(dir, e.name), r, d + 1));
            else out.push(r);
        }
        return out;
    };
    const allFiles = await scanDir(sourceDir);
    const keySnippets: string[] = [];
    for (const f of ['package.json', 'requirements.txt', 'frontend/package.json', 'backend/package.json',
        'backend/requirements.txt', 'pyproject.toml']) {
        const content = await fs.readFile(path.join(sourceDir, f), 'utf8').catch(() => null);
        if (content) keySnippets.push(`=== ${f} ===\n${content.slice(0, 400)}`);
    }

    const prompt = `You are a DevOps expert. Generate the minimum Dockerfile(s) needed to run this project.

File tree (${allFiles.length} files):
${allFiles.slice(0, 80).join('\n')}

Key configs:
${keySnippets.join('\n\n') || '(none)'}

Rules:
- If project has a single top-level package.json → one Dockerfile at root, Node 18 Alpine, port 3000, use "npx next dev -p 3000" or "npm run dev"
- If project has separate frontend/ + backend/ directories → two Dockerfiles: frontend/Dockerfile (Node 18, port 3000) and backend/Dockerfile (Python 3.11-slim or Node 18, port 8000)
- If project is pure Python → one Dockerfile at root, Python 3.11-slim, port 8000
- Always include a .dockerignore at root: node_modules, .next, dist, .git, __pycache__, .venv
- Use development mode (hot reload) since this is a preview deployment
- npm install must use --legacy-peer-deps flag

Respond with ONLY valid JSON (no markdown):
{
  "files": [
    { "path": "Dockerfile", "content": "FROM node:18-alpine\\n..." },
    { "path": ".dockerignore", "content": "node_modules\\n.next\\n..." }
  ]
}`;

    try {
        const raw = await callAgentChat([{ role: 'user', content: prompt }], 0.1);
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleaned) as { files: Array<{ path: string; content: string }> };
        if (!Array.isArray(parsed.files)) throw new Error('no files array');

        for (const { path: relPath, content } of parsed.files) {
            const safe = relPath.replace(/\.\./g, '').replace(/^\//, '');
            const fullPath = path.join(sourceDir, safe);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content, 'utf8');
            console.log(`[persistSourceForDeploy] AI wrote ${safe} (${content.length} chars)`);
        }
    } catch (e) {
        console.warn('[persistSourceForDeploy] AI Dockerfile generation failed:', (e as Error).message);
        // Write a basic fallback Dockerfile so deployment doesn't fail with "cannot detect project type"
        const hasPkg = allFiles.includes('package.json') ||
            await fs.access(path.join(sourceDir, 'package.json')).then(() => true).catch(() => false);
        const fallback = hasPkg
            ? ['FROM node:18-alpine', 'WORKDIR /app', 'COPY package*.json tsconfig*.json ./',
               'RUN npm install --no-audit --no-fund --legacy-peer-deps', 'COPY . .',
               'ENV NODE_ENV=development', 'ENV NEXT_TELEMETRY_DISABLED=1', 'EXPOSE 3000',
               'CMD ["npx", "next", "dev", "-p", "3000"]'].join('\n')
            : ['FROM python:3.11-slim', 'WORKDIR /app',
               allFiles.includes('requirements.txt') ? 'COPY requirements.txt ./\nRUN pip install -r requirements.txt --no-cache-dir' : '',
               'COPY . .', 'EXPOSE 8000', 'CMD ["python3", "app.py"]'].filter(Boolean).join('\n');
        await fs.writeFile(path.join(sourceDir, 'Dockerfile'), fallback, 'utf8').catch(() => { /* ignore */ });
        await fs.writeFile(path.join(sourceDir, '.dockerignore'),
            'node_modules\n.next\ndist\n.git\n__pycache__\n*.pyc\n.venv\n', 'utf8').catch(() => { /* ignore */ });
        // Write tsconfig.json with @/* path alias so AI-generated imports like
        // `import Foo from "@/features/foo/Foo"` resolve to both root and src/.
        if (hasPkg) {
            const tsconfigPath = path.join(sourceDir, 'tsconfig.json');
            const hasTsconfig = await fs.access(tsconfigPath).then(() => true).catch(() => false);
            if (!hasTsconfig) {
                const tsconfig = {
                    compilerOptions: {
                        target: 'es5', lib: ['dom', 'dom.iterable', 'esnext'],
                        allowJs: true, skipLibCheck: true, strict: true,
                        noEmit: true, esModuleInterop: true, module: 'esnext',
                        moduleResolution: 'bundler', resolveJsonModule: true,
                        isolatedModules: true, jsx: 'preserve', incremental: true,
                        paths: { '@/*': ['./*', './src/*'] },
                    },
                    include: ['**/*.ts', '**/*.tsx'],
                    exclude: ['node_modules'],
                };
                await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8').catch(() => { /* ignore */ });
            }
        }
    }
}

async function copyTemplateTree(srcRoot: string, dstRoot: string): Promise<void> {
    const SKIP = new Set(['node_modules', '.next', 'dist', '.git', '.vitest-cache', 'coverage']);
    async function walk(dir: string, rel: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            if (SKIP.has(e.name)) continue;
            const abs = path.join(dir, e.name);
            const relPath = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                await fs.mkdir(path.join(dstRoot, relPath), { recursive: true });
                await walk(abs, relPath);
            } else if (e.isFile()) {
                const target = path.join(dstRoot, relPath);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(abs, target);
            }
        }
    }
    await walk(srcRoot, '');
}

const DEFER_PRS_BY_DEFAULT = process.env.DEFER_PR_CREATION !== 'false';

export async function implementSprint(
    repo: string,
    designExcerpt: unknown,
    tickets: SprintTicket[],
    runId: string | null = null,
    templateId: string | null = null,
    opts: { skipPR?: boolean } = {},
    humanAssignees: Set<string> = new Set(),
): Promise<SprintResult> {
    const skipPR = opts.skipPR ?? DEFER_PRS_BY_DEFAULT;
    // Drop scaffold-duplicate tickets up front. Stage 5's prompt was updated to
    // skip these, but we keep this filter as defense in depth — if the LLM
    // re-emits a scaffold ticket, we record it as skipped rather than open a
    // PR that fights the scaffold service's PR.
    const outcomesPrefilter: TicketOutcome[] = [];
    const survivingTickets: SprintTicket[] = [];
    for (const t of tickets) {
        const reason = isScaffoldTicket(t);
        if (reason) {
            outcomesPrefilter.push({
                ticket_id: t.id, title: t.title,
                pr_url: null, pr_number: null, branch_name: null, base_branch: null,
                attempts: 0, final_errors: [],
                skipped: `scaffold-duplicate (${reason}) — scaffold service handles this`,
            });
        } else {
            survivingTickets.push(t);
        }
    }
    const ordered = topoSortTickets(survivingTickets);
    const outcomes: TicketOutcome[] = [...outcomesPrefilter];
    const accumulatedTree: Record<string, string> = {};
    const successByTicket = new Map<string, boolean>();
    // Tracks which tickets are waiting on a human (distinct from failed).
    const waitingOnHuman = new Set<string>();

    for (let i = 0; i < ordered.length; i++) {
        const t = ordered[i];
        const known = new Set(ordered.map(x => x.id));

        // Human-assigned tickets: system skips them and waits.
        if (humanAssignees.has(t.id)) {
            outcomes.push({
                ticket_id: t.id, title: t.title,
                pr_url: null, pr_number: null, branch_name: null, base_branch: null,
                attempts: 0, final_errors: [],
                skipped: `assigned to human — awaiting manual completion`,
            });
            successByTicket.set(t.id, false);
            waitingOnHuman.add(t.id);
            await pushSprintProgress(runId, outcomes, null);
            continue;
        }

        // Skip if any declared dependency failed or is waiting on human.
        const blockedByFailed = (t.dependencies || []).filter(d => known.has(d) && successByTicket.get(d) === false && !waitingOnHuman.has(d));
        const blockedByHuman = (t.dependencies || []).filter(d => known.has(d) && waitingOnHuman.has(d));

        if (blockedByHuman.length > 0) {
            outcomes.push({
                ticket_id: t.id, title: t.title,
                pr_url: null, pr_number: null, branch_name: null, base_branch: null,
                attempts: 0, final_errors: [],
                skipped: `waiting on human-assigned dependency: ${blockedByHuman.join(', ')}`,
            });
            successByTicket.set(t.id, false);
            waitingOnHuman.add(t.id);
            await pushSprintProgress(runId, outcomes, null);
            continue;
        }

        if (blockedByFailed.length > 0) {
            outcomes.push({
                ticket_id: t.id, title: t.title,
                pr_url: null, pr_number: null, branch_name: null, base_branch: null,
                attempts: 0, final_errors: [],
                skipped: `blocked by failed dependency: ${blockedByFailed.join(', ')}`,
            });
            successByTicket.set(t.id, false);
            await pushSprintProgress(runId, outcomes, null);
            continue;
        }

        await pushSprintProgress(runId, outcomes, { id: t.id, index: i + 1, total: ordered.length, status: 'starting' });

        // The Dify implementation app is single-ticket — feed it the ticket
        // and let it author files. We don't pre-call Dify here; finalize
        // will trigger a call if initialImpl is null.
        const result = await finalizeImplementation(
            repo,
            t,
            designExcerpt,
            null, // no initial impl — backend will call Dify
            runId,
            { existingTree: { ...accumulatedTree }, skipPR },
        );

        // "Implemented" means the agent loop produced a valid impl + sandbox
        // tests passed. When skipPR is on, that's the success signal (PR
        // creation is deferred). When off, we additionally require pr_url.
        const implementedOk = skipPR
            ? !!result.final_implementation_json && result.final_errors.length === 0
            : !!result.pr_url;

        outcomes.push({
            ticket_id: t.id,
            title: t.title,
            pr_url: result.pr_url,
            pr_number: result.pr_number,
            branch_name: result.branch_name,
            base_branch: null,
            attempts: result.attempts,
            final_errors: result.final_errors,
            implementation_json: result.final_implementation_json,
            ticket_payload: t,
        });
        successByTicket.set(t.id, implementedOk);

        // If this ticket succeeded (implementation valid; PR optional), fold its
        // files into the accumulated tree so dependent tickets see them.
        if (implementedOk && result.final_implementation_json) {
            for (const f of result.final_implementation_json.files_changed || []) {
                if (!f.path || f.action === 'delete') continue;
                accumulatedTree[f.path] = f.contents ?? '';
            }
        }

        await pushSprintProgress(runId, outcomes, null);
    }

    // Stash the runnable source tree so the Deploy-Locally feature can spawn
    // the generated app without re-fetching from GitHub.
    await persistSourceForDeploy(runId, accumulatedTree, templateId);

    const isImplemented = (o: TicketOutcome) =>
        !o.skipped && !!o.implementation_json && o.final_errors.length === 0;
    return {
        pr_urls: outcomes.filter(o => o.pr_url).map(o => o.pr_url!),
        outcomes,
        skipped_count: outcomes.filter(o => o.skipped).length,
        failed_count: outcomes.filter(o => !isImplemented(o) && !o.skipped).length,
        succeeded_count: outcomes.filter(isImplemented).length,
    };
}

// ─── Deferred PR creation ────────────────────────────────────────────────────

export interface CreatedPR {
    ticket_id: string;
    title: string;
    pr_url: string;
    pr_number: number;
    branch_name: string;
    reused: boolean;
}

export interface CreatePRsResult {
    created: CreatedPR[];
    skipped: Array<{ ticket_id: string; reason: string }>;
    failed: Array<{ ticket_id: string; error: string }>;
}

/**
 * Create GitHub PRs for every successfully-implemented ticket on a run that
 * hasn't been pushed yet. Reads outcomes from artifact_json.sprint.outcomes,
 * pushes branches+PRs, then writes the resulting pr_url/pr_number back into
 * the same outcomes array. Idempotent — tickets that already have a pr_url
 * are left alone.
 */
export async function createPRsForRun(runId: string): Promise<CreatePRsResult> {
    const pat = process.env.GITHUB_PAT;
    if (!pat) throw new Error('GITHUB_PAT not configured — cannot create PRs');

    const runRes = await pool.query<{ repo_full_name: string }>(
        `SELECT repo_full_name FROM pipeline_runs WHERE run_id = $1`,
        [runId]
    );
    if (runRes.rowCount === 0) throw new Error('run not found');
    const repo = runRes.rows[0].repo_full_name;
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) throw new Error(`repo "${repo}" must be owner/name`);

    const stageRes = await pool.query<{ artifact_json: any }>(
        `SELECT artifact_json FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'implementation'`,
        [runId]
    );
    if (stageRes.rowCount === 0) throw new Error('implementation stage has no artifact_json');
    const artifact = stageRes.rows[0].artifact_json || {};
    const sprint = artifact.sprint;
    const outcomes: TicketOutcome[] = Array.isArray(sprint?.outcomes) ? sprint.outcomes : [];
    if (outcomes.length === 0) throw new Error('no outcomes to create PRs from');

    const created: CreatedPR[] = [];
    const skipped: Array<{ ticket_id: string; reason: string }> = [];
    const failed: Array<{ ticket_id: string; error: string }> = [];

    for (const o of outcomes) {
        if (o.skipped) {
            skipped.push({ ticket_id: o.ticket_id, reason: 'blocked / not implemented' });
            continue;
        }
        if (!o.implementation_json) {
            skipped.push({ ticket_id: o.ticket_id, reason: 'no implementation_json (likely failed validation)' });
            continue;
        }
        if (o.final_errors && o.final_errors.length > 0) {
            skipped.push({ ticket_id: o.ticket_id, reason: 'ticket has final_errors — not safe to push' });
            continue;
        }
        const impl = o.implementation_json;
        if (!impl.branch_name) {
            failed.push({ ticket_id: o.ticket_id, error: 'implementation_json has no branch_name' });
            continue;
        }
        try {
            const reuseExisting = !!o.pr_url;
            const pr = await githubService.createBranchAndPR(pat, owner, repoName, {
                branchName: impl.branch_name,
                commitMessage: impl.commit_message || `feat: ${o.title}`,
                filesChanged: impl.files_changed || [],
                prTitle: impl.pr_title || o.title || impl.branch_name,
                prBody: impl.pr_body_markdown || '',
            });
            o.pr_url = pr.prUrl;
            o.pr_number = pr.prNumber;
            o.branch_name = pr.branchName;
            created.push({
                ticket_id: o.ticket_id,
                title: o.title,
                pr_url: pr.prUrl,
                pr_number: pr.prNumber,
                branch_name: pr.branchName,
                reused: reuseExisting,
            });
        } catch (e) {
            failed.push({ ticket_id: o.ticket_id, error: e instanceof Error ? e.message : 'unknown' });
        }
    }

    // Persist the updated outcomes back into artifact_json. Using a merge so we
    // don't clobber the `agent` / `parsed` / etc. envelope siblings.
    const newSprint = {
        ...sprint,
        outcomes,
        succeeded_count: outcomes.filter(o => !!o.pr_url).length,
    };
    await pool.query(
        `UPDATE pipeline_stage_status
           SET artifact_json = COALESCE(artifact_json, '{}'::jsonb)
                             || jsonb_build_object('sprint', $2::jsonb)
         WHERE run_id = $1 AND stage = 'implementation'`,
        [runId, JSON.stringify(newSprint)],
    );

    return { created, skipped, failed };
}


