/**
 * Azure OpenAI GPT agentic implementation loop.
 *
 * Same tool-use workflow as claudeCodeAgentService but drives the Azure OpenAI
 * chat-completions API (OpenAI tool_calls / function-calling wire format):
 *
 *   list files → read context → write code → run tsc/pytest/npm test →
 *   fix errors → run tests again → call finish() when passing
 *
 * Message threading differences from the Anthropic SDK:
 *  - Tools defined as { type:"function", function:{name,description,parameters} }
 *  - Assistant turn has message.tool_calls[] (not content[] blocks)
 *  - Tool results are { role:"tool", tool_call_id, content } messages
 *  - finish_reason:"tool_calls" (not stop_reason:"tool_use")
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { agentConfig, azureConfig } from '../config/azure';
import type { ImplementationJson, FileChange } from './agentImplementationService';
import type { AgentPhase, AgentRunOptions } from './claudeCodeAgentService';

const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || '50', 10);
const BASH_TIMEOUT_MS = parseInt(process.env.AGENT_BASH_TIMEOUT_MS || '120000', 10);
// Warn the agent to wrap up when this many turns remain
const WRAP_UP_TURNS_REMAINING = 6;

const SKIP_DIRS = new Set([
    'node_modules', '.next', 'dist', '.git', '__pycache__',
    '.venv', 'venv', 'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache',
]);

const BLOCKED_PATTERNS = [
    /rm\s+-[rf]{1,2}\s*\//,
    /\bdd\b.*\/dev\//,
    /\bmkfs\b/,
    />\s*\/dev\/sd/,
    /\bsudo\b/,
    /\bchmod\s+[0-7]{3,4}\s+\//,
];

// ─── OpenAI message types (no SDK — plain fetch) ──────────────────────────────

interface OAIToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

type OAIMessage =
    | { role: 'system';    content: string }
    | { role: 'user';      content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
    | { role: 'tool';      tool_call_id: string; content: string };

interface OAIChoice {
    finish_reason: 'stop' | 'tool_calls' | 'length' | string;
    message: { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] };
}

interface OAIResponse {
    choices: OAIChoice[];
}

interface OAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
}

// ─── Azure API helper ─────────────────────────────────────────────────────────

// Azure AI Foundry Serverless endpoints (services.ai.azure.com/openai/v1/) use
// OpenAI-style /v1/ paths and reject the api-version query param. Traditional
// Azure OpenAI (cognitiveservices.azure.com) requires it.
function isFoundryEndpoint(endpoint: string): boolean {
    return endpoint.includes('.services.ai.azure.com') || endpoint.includes('/openai/v1/');
}

interface ModelConfig {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
}

async function callWithConfig(
    cfg: ModelConfig,
    messages: OAIMessage[],
    tools: OAITool[],
): Promise<{ resp: Response; body: string; ok: boolean }> {
    const { endpoint, apiKey, deployment, apiVersion } = cfg;
    const foundry = isFoundryEndpoint(endpoint);

    let url: string;
    if (endpoint.includes('/chat/completions')) {
        url = foundry ? endpoint : `${endpoint}?api-version=${apiVersion}`;
    } else {
        url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    }

    // Foundry/Kimi uses max_tokens; Azure OpenAI (gpt-5.5+) uses max_completion_tokens
    const tokenLimit = foundry ? { max_tokens: 8192 } : { max_completion_tokens: 8192 };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
            model: deployment,
            messages,
            tools,
            // 'required' forces the model to call a tool every turn — it cannot
            // respond with plain text. This prevents Kimi from "acknowledging"
            // the write-nudge in prose instead of calling write_file.
            tool_choice: 'required',
            ...tokenLimit,
        }),
    });

    const body = resp.ok ? '' : await resp.text();
    return { resp, body, ok: resp.ok };
}

// Try agentConfig (Kimi K2.5) first; fall back to azureConfig (GPT-5.5) on 429.
async function callAzureWithTools(
    messages: OAIMessage[],
    tools: OAITool[],
): Promise<OAIResponse> {
    const primary = agentConfig;
    const fallback: ModelConfig = {
        endpoint:   azureConfig.openAIEndpoint,
        apiKey:     azureConfig.openAIApiKey,
        deployment: azureConfig.openAIDeployment,
        apiVersion: azureConfig.openAIApiVersion,
    };

    let { resp, body, ok } = await callWithConfig(primary, messages, tools);

    // Fall back to GPT-5.5 if primary is rate-limited or quota-exhausted
    if (!ok && resp.status === 429 && primary.endpoint !== fallback.endpoint) {
        console.warn(`[agent] ${primary.deployment} rate-limited (429), falling back to ${fallback.deployment}`);
        ({ resp, body, ok } = await callWithConfig(fallback, messages, tools));
    }

    if (!ok) {
        throw new Error(`Azure OpenAI error ${resp.status}: ${body.slice(0, 400)}`);
    }

    return resp.json() as Promise<OAIResponse>;
}

// ─── Workspace helpers ────────────────────────────────────────────────────────

async function walkWorkspace(dir: string, relBase = '', depth = 0): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (depth > 6) return result;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
            const sub = await walkWorkspace(path.join(dir, e.name), rel, depth + 1);
            for (const [k, v] of sub) result.set(k, v);
        } else if (e.isFile()) {
            const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
            if (stat && stat.size < 256 * 1024) {
                const content = await fs.readFile(path.join(dir, e.name), 'utf8').catch(() => null);
                if (content !== null) result.set(rel, content);
            }
        }
    }
    return result;
}

async function safePath(workspaceDir: string, relOrAbs: string): Promise<string | null> {
    const rel = relOrAbs.replace(/^\/+/, '');
    const abs = path.resolve(path.join(workspaceDir, rel));
    return abs.startsWith(workspaceDir + path.sep) || abs === workspaceDir ? abs : null;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

async function runBash(command: string, cwd: string): Promise<string> {
    for (const p of BLOCKED_PATTERNS) {
        if (p.test(command)) return '[BLOCKED] Command matches a blocked pattern and was not executed.';
    }
    return new Promise((resolve) => {
        const proc = spawn('bash', ['-c', command], {
            cwd,
            env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1', CI: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        const append = (s: string) => { out += s; if (out.length > 12000) out = '…[truncated]\n' + out.slice(-10000); };
        proc.stdout?.on('data', (d: Buffer) => append(d.toString()));
        proc.stderr?.on('data', (d: Buffer) => append(d.toString()));
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* ok */ }
            resolve(`[TIMEOUT after ${BASH_TIMEOUT_MS / 1000}s]\n${out}`);
        }, BASH_TIMEOUT_MS);
        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve(code !== 0 ? `[exit ${code}]\n${out || '(no output)'}` : (out || '(no output)'));
        });
        proc.on('error', (e) => { clearTimeout(timer); resolve(`[spawn error] ${e.message}`); });
    });
}

async function executeTool(name: string, input: Record<string, unknown>, workspaceDir: string): Promise<string> {
    try {
        switch (name) {
            case 'read_file': {
                const abs = await safePath(workspaceDir, String(input.path ?? ''));
                if (!abs) return '[ERROR] Path is outside the workspace.';
                return await fs.readFile(abs, 'utf8').catch((e: Error) => `[ERROR] ${e.message}`);
            }
            case 'write_file': {
                const abs = await safePath(workspaceDir, String(input.path ?? ''));
                if (!abs) return '[ERROR] Path is outside the workspace.';
                await fs.mkdir(path.dirname(abs), { recursive: true });
                await fs.writeFile(abs, String(input.content ?? ''), 'utf8');
                return `[OK] Wrote ${path.relative(workspaceDir, abs)}`;
            }
            case 'list_files': {
                const abs = await safePath(workspaceDir, String(input.path ?? '.'));
                if (!abs) return '[ERROR] Path is outside the workspace.';
                let entries: import('fs').Dirent[];
                try { entries = await fs.readdir(abs, { withFileTypes: true }); }
                catch (e) { return `[ERROR] ${(e as Error).message}`; }
                return entries
                    .filter(d => !SKIP_DIRS.has(d.name) && !d.name.startsWith('.'))
                    .map(d => `${d.isDirectory() ? 'd' : 'f'} ${d.name}`)
                    .join('\n') || '(empty directory)';
            }
            case 'bash': {
                const command = String(input.command ?? '');
                if (!command.trim()) return '[ERROR] Empty command.';
                return await runBash(command, workspaceDir);
            }
            default:
                return `[ERROR] Unknown tool: ${name}`;
        }
    } catch (e) {
        return `[ERROR] Tool execution failed: ${(e as Error).message}`;
    }
}

// ─── Tool definitions (OpenAI function-calling format) ────────────────────────

function buildTools(): OAITool[] {
    return [
        {
            type: 'function',
            function: {
                name: 'list_files',
                description: 'List files and directories. Use this first to understand the project structure.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Directory path relative to workspace root (default: "." for root)' },
                    },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'read_file',
                description: 'Read the contents of a file. Always read existing files before modifying them.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to workspace root' },
                    },
                    required: ['path'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'write_file',
                description: 'Write or create a file. Use for implementation files AND test files.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to workspace root' },
                        content: { type: 'string', description: 'Complete file content (not a diff or snippet)' },
                    },
                    required: ['path', 'content'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'bash',
                description: [
                    'Run a shell command in the workspace directory. Use for:',
                    '- Type checking: npx tsc --noEmit',
                    '- Node tests: npm test (or npx vitest run, npx jest --no-coverage)',
                    '- Install deps: npm install --no-audit --no-fund --legacy-peer-deps',
                    '- Quick syntax check: node -c file.js',
                    'All paths and file ops are scoped to the workspace directory.',
                ].join('\n'),
                parameters: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: 'Shell command to run' },
                    },
                    required: ['command'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'finish',
                description: [
                    'Submit the completed implementation. Call this when:',
                    '1. All required files are written',
                    '2. At least one test file (path contains test/spec/__tests__) exists',
                    '3. Tests are passing for the files you wrote (confirmed with bash)',
                    '4. Type checking passes (for TypeScript projects)',
                    'IMPORTANT: If you are running low on turns, call finish() immediately with what you have rather than continuing to iterate.',
                ].join('\n'),
                parameters: {
                    type: 'object',
                    properties: {
                        branch_name: {
                            type: 'string',
                            description: 'Git branch: feat/<ticket-id-lowercase>-<short-slug>. Only [a-zA-Z0-9._/-] chars.',
                        },
                        commit_message: {
                            type: 'string',
                            description: 'Conventional commit: feat(scope): short summary',
                        },
                        pr_title: {
                            type: 'string',
                            description: 'PR title, imperative mood, under 70 chars',
                        },
                        pr_body_markdown: {
                            type: 'string',
                            description: 'PR body with sections: ## Context, ## Changes, ## Testing, ## Self-review',
                        },
                        self_review_notes: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Honest notes: edge cases, risks, things you skipped',
                        },
                    },
                    required: ['branch_name', 'commit_message', 'pr_title', 'pr_body_markdown'],
                },
            },
        },
    ];
}

// ─── Phase inference ──────────────────────────────────────────────────────────

function inferPhase(toolName: string, prevPhase: AgentPhase): AgentPhase {
    if (toolName === 'finish') return 'finishing';
    if (toolName === 'bash') return prevPhase === 'writing' ? 'testing' : prevPhase === 'testing' ? 'fixing' : 'testing';
    if (toolName === 'write_file') return prevPhase === 'exploring' ? 'writing' : prevPhase;
    if (toolName === 'read_file' || toolName === 'list_files') {
        return prevPhase === 'testing' || prevPhase === 'fixing' ? 'fixing' : 'exploring';
    }
    return prevPhase;
}

// ─── Salvage: build ImplementationJson from workspace without finish() ─────────

async function salvageWorkspace(
    workspaceDir: string,
    initialSnapshot: Map<string, string>,
    wsId: string,
    ticketId: string,
): Promise<ImplementationJson> {
    const currentTree = await walkWorkspace(workspaceDir);
    const filesChanged: FileChange[] = [];
    const testFilesAdded: string[] = [];

    for (const [rel, content] of currentTree) {
        const wasInitial = initialSnapshot.get(rel);
        if (wasInitial === undefined) {
            filesChanged.push({ path: rel, action: 'create', contents: content });
            if (/test|spec|__tests__/i.test(rel)) testFilesAdded.push(rel);
        } else if (wasInitial !== content) {
            filesChanged.push({ path: rel, action: 'modify', contents: content });
        }
    }
    for (const rel of initialSnapshot.keys()) {
        if (!currentTree.has(rel)) filesChanged.push({ path: rel, action: 'delete' });
    }

    const slug = ticketId.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    return {
        branch_name: `feat/${slug}-${wsId.slice(-5)}`,
        commit_message: `feat: implement ${ticketId}`,
        files_changed: filesChanged,
        diff_summary: `${filesChanged.filter(f => f.action === 'create').length} created, ` +
            `${filesChanged.filter(f => f.action === 'modify').length} modified, ` +
            `${filesChanged.filter(f => f.action === 'delete').length} deleted`,
        test_files_added: testFilesAdded,
        self_review_notes: ['Implementation salvaged after turn limit — some tests may not pass'],
        pr_title: `feat: implement ${ticketId}`,
        pr_body_markdown: '## Note\nImplementation reached turn limit. Files written have been captured.',
    };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the Azure OpenAI GPT agentic loop for a single ticket.
 * Same contract as runAgentForTicket in claudeCodeAgentService —
 * drop-in replacement using gpt-5.5 via Azure.
 */
export async function runAzureAgentForTicket(
    repo: string,
    ticket: unknown,
    designExcerpt: unknown,
    existingTree: Record<string, string>,
    runId: string | null,
    opts: AgentRunOptions = {},
): Promise<ImplementationJson> {
    const { endpoint: openAIEndpoint, apiKey: openAIApiKey, deployment: openAIDeployment } = agentConfig;
    if (!openAIEndpoint || !openAIApiKey) {
        throw new Error('Azure OpenAI endpoint or API key not configured');
    }

    // ── Set up workspace ──────────────────────────────────────────────────────
    const wsId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workspaceDir = path.join(DEPLOYMENTS_ROOT, runId ?? 'scratch', `agent-ws-${wsId}`);
    await fs.mkdir(workspaceDir, { recursive: true });

    for (const [rel, content] of Object.entries(existingTree)) {
        const abs = path.join(workspaceDir, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
    }

    // Symlink node_modules from the scaffold template so the agent can run
    // npm test / npx vitest without wasting turns on npm install.
    const templateNodeModules = '/app/templates/next-app-shadcn/node_modules';
    const wsNodeModules = path.join(workspaceDir, 'node_modules');
    await fs.symlink(templateNodeModules, wsNodeModules).catch(() => {});

    const initialSnapshot = new Map(Object.entries(existingTree));

    const liveLog = opts.liveLogPath
        ? { write: (s: string) => fs.appendFile(opts.liveLogPath!, s).catch(() => {}) }
        : null;
    const logLine = (s: string) => liveLog?.write(s + '\n');

    // ── Prompts ───────────────────────────────────────────────────────────────
    const ticketObj = typeof ticket === 'object' && ticket !== null ? ticket as Record<string, unknown> : {};
    const ticketId = String(ticketObj.id ?? ticketObj.ticket_id ?? 'ticket');
    const ticketStr = typeof ticket === 'string' ? ticket : JSON.stringify(ticket, null, 2);
    const designStr = (typeof designExcerpt === 'string' ? designExcerpt : JSON.stringify(designExcerpt)).slice(0, 4000);

    const systemContent = `You are an expert software engineer implementing a development ticket.

You work in a real directory and have tools to read files, write files, run shell commands, and submit when done.

## Workflow
1. **Explore** — list_files to understand project structure, read_file for relevant existing code
2. **Implement** — write_file for all new/modified files (implementation + tests)
3. **Test** — bash to run the test suite for the files you wrote
4. **Fix** — read errors, fix files, run tests again
5. **Finish** — call finish() when your tests pass

## Rules
- Read existing files before editing them — understand naming conventions and imports
- Write at least one test file (path must contain "test", "spec", or "__tests__")
- Tests must PASS for YOUR files before you call finish() — verify with bash
- **Match the test language/framework to the project tech stack:**
  - If \`package.json\` exists → the project is JavaScript/TypeScript. Write tests in TypeScript/JavaScript (.test.ts, .test.tsx, .spec.ts). Use the framework already in devDependencies (vitest, jest, @testing-library, etc.). NEVER write Python (.py) files for a JavaScript/TypeScript project.
  - If \`requirements.txt\`, \`setup.py\`, or \`pyproject.toml\` exists (and no package.json) → Python project. Write pytest tests.
- For TypeScript projects: run \`npx tsc --noEmit\` and fix all type errors before finishing
- For Next.js projects (\`next.config.*\` exists): also run \`npm run build 2>&1 | tail -30\` — tsc alone misses React rendering errors. Fix ALL build errors before finishing.
- React component files that contain JSX MUST use \`.tsx\` extension (not \`.ts\`). Files with only TypeScript logic may use \`.ts\`.
- Next.js App Router page components must: use \`export default function\`, return \`JSX.Element\` (actual React JSX — not a controller or plain object), and include \`'use client'\` if they use hooks or browser APIs.
- Do NOT modify: package.json, package-lock.json, yarn.lock, tsconfig.json (unless creating from scratch)
- Run tests only for the files you wrote — not the entire test suite (other tickets may have broken tests)
- branch_name: only [a-zA-Z0-9._/-] chars, format feat/<ticket-id>-<slug>
- commit_message: Conventional Commits, e.g. "feat(calc): add currency conversion"
- **Turn budget**: You have ${MAX_TURNS} turns total. When ${WRAP_UP_TURNS_REMAINING} or fewer turns remain, STOP iterating and call finish() immediately with your best work.

## Repo context
Repository: ${repo}${opts.systemPromptSuffix ? `\n\n${opts.systemPromptSuffix}` : ''}`;

    const userContent = `Implement this ticket:

\`\`\`json
${ticketStr}
\`\`\`

Technical design context:
\`\`\`
${designStr}
\`\`\``;

    // ── Agent loop ────────────────────────────────────────────────────────────
    const messages: OAIMessage[] = [
        { role: 'system', content: systemContent },
        { role: 'user',   content: userContent },
    ];
    const tools = buildTools();
    let turnCount = 0;
    let phase: AgentPhase = 'exploring';
    let implementationJson: ImplementationJson | null = null;
    let wrapUpInjected = false;
    let writeNudgeInjected = false;
    let finishNudgeInjected = false;
    let filesWrittenCount = 0;
    // After this many turns with no write_file calls, nudge the agent to stop exploring
    const EXPLORE_CAP_TURNS = 6;

    logLine(`[gpt-agent] starting — workspace: ${workspaceDir}`);
    logLine(`[gpt-agent] model: ${openAIDeployment}, max turns: ${MAX_TURNS}`);

    try {
        while (turnCount < MAX_TURNS && !implementationJson) {
            turnCount++;

            // Inject wrap-up warning when close to turn limit
            const turnsRemaining = MAX_TURNS - turnCount;
            if (turnsRemaining <= WRAP_UP_TURNS_REMAINING && !wrapUpInjected) {
                wrapUpInjected = true;
                messages.push({
                    role: 'user',
                    content: `⚠️ TURN BUDGET WARNING: You have ${turnsRemaining} turns remaining. ` +
                        `Stop testing and call finish() RIGHT NOW with whatever you have. ` +
                        `Do not run any more bash commands. Call finish() immediately.`,
                });
                logLine(`[gpt-agent turn ${turnCount}] injected wrap-up warning (${turnsRemaining} turns left)`);
            }

            // If the agent has spent too many turns exploring without writing anything, force it to start
            if (!writeNudgeInjected && filesWrittenCount === 0 && turnCount > EXPLORE_CAP_TURNS) {
                writeNudgeInjected = true;
                messages.push({
                    role: 'user',
                    content: `⚠️ You have used ${turnCount} turns without writing any files. ` +
                        `STOP exploring. You have enough context. ` +
                        `Call write_file NOW to create your implementation files. ` +
                        `Do NOT make any more read_file, list_files, or bash calls until you have written at least one file.`,
                });
                logLine(`[gpt-agent turn ${turnCount}] injected write-nudge (no files written after ${turnCount} turns)`);
            }

            const response = await callAzureWithTools(messages, tools);
            const choice = response.choices[0];
            if (!choice) throw new Error('Azure OpenAI returned no choices');

            const assistantMsg = choice.message;

            // Append assistant turn
            messages.push({
                role: 'assistant',
                content: assistantMsg.content ?? null,
                tool_calls: assistantMsg.tool_calls,
            });

            if (assistantMsg.content?.trim()) {
                logLine(`[gpt-agent turn ${turnCount}] ${assistantMsg.content.slice(0, 300)}`);
            }

            if (choice.finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
                logLine(`[gpt-agent] stopped (${choice.finish_reason}) after ${turnCount} turns`);
                // Kimi K2.5 sometimes outputs a text response instead of calling finish().
                // Nudge it ONCE to call finish() rather than giving up.
                if (!finishNudgeInjected && filesWrittenCount > 0 && turnCount < MAX_TURNS - 1) {
                    finishNudgeInjected = true;
                    messages.push({
                        role: 'user',
                        content: `You stopped without calling finish(). You have written ${filesWrittenCount} file(s). ` +
                            `Call finish() now with branch_name, commit_message, pr_title, and pr_body_markdown.`,
                    });
                    logLine(`[gpt-agent turn ${turnCount}] injected finish-nudge (${filesWrittenCount} files written, stopped without finish())`);
                    continue;
                }
                break;
            }

            if (choice.finish_reason !== 'tool_calls') break;

            // Execute each tool call and collect results
            for (const tc of assistantMsg.tool_calls) {
                const toolName = tc.function.name;
                let toolInput: Record<string, unknown>;
                try { toolInput = JSON.parse(tc.function.arguments); }
                catch { toolInput = {}; }

                phase = inferPhase(toolName, phase);
                logLine(`[tool:${toolName}] ${tc.function.arguments.slice(0, 200)}`);
                await opts.onProgress?.(turnCount, phase, `${toolName}(${Object.keys(toolInput).join(', ')})`);

                // ── finish() ─────────────────────────────────────────────────
                if (toolName === 'finish') {
                    const fi = toolInput as {
                        branch_name?: string;
                        commit_message?: string;
                        pr_title?: string;
                        pr_body_markdown?: string;
                        self_review_notes?: string[];
                    };

                    const currentTree = await walkWorkspace(workspaceDir);
                    const filesChanged: FileChange[] = [];
                    const testFilesAdded: string[] = [];

                    for (const [rel, content] of currentTree) {
                        const wasInitial = initialSnapshot.get(rel);
                        if (wasInitial === undefined) {
                            filesChanged.push({ path: rel, action: 'create', contents: content });
                            if (/test|spec|__tests__/i.test(rel)) testFilesAdded.push(rel);
                        } else if (wasInitial !== content) {
                            filesChanged.push({ path: rel, action: 'modify', contents: content });
                        }
                    }
                    for (const rel of initialSnapshot.keys()) {
                        if (!currentTree.has(rel)) filesChanged.push({ path: rel, action: 'delete' });
                    }

                    const branchName = (fi.branch_name ?? `feat/ticket-${wsId}`).replace(/\s+/g, '-');

                    implementationJson = {
                        branch_name: branchName,
                        commit_message: fi.commit_message ?? 'feat: implement ticket',
                        files_changed: filesChanged,
                        diff_summary: `${filesChanged.filter(f => f.action === 'create').length} created, ` +
                            `${filesChanged.filter(f => f.action === 'modify').length} modified, ` +
                            `${filesChanged.filter(f => f.action === 'delete').length} deleted`,
                        test_files_added: testFilesAdded,
                        self_review_notes: fi.self_review_notes ?? [],
                        pr_title: fi.pr_title ?? branchName,
                        pr_body_markdown: fi.pr_body_markdown ?? '',
                    };

                    logLine(`[gpt-agent] finish() called at turn ${turnCount}: ${implementationJson.diff_summary}`);
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: '[OK] Implementation recorded.' });
                    break;
                }

                // ── other tools ───────────────────────────────────────────────
                const result = await executeTool(toolName, toolInput, workspaceDir);
                // Only count writes that actually landed on disk
                if (toolName === 'write_file' && result.startsWith('[OK]')) filesWrittenCount++;
                logLine(`[result] ${result.slice(0, 500)}`);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            }
        }
    } catch (e) {
        logLine(`[gpt-agent] error: ${(e as Error).message}`);
        throw e;
    }

    // ── Salvage: if finish() was never called, collect whatever was written ──
    if (!implementationJson) {
        const currentTree = await walkWorkspace(workspaceDir);
        const hasChanges =
            [...currentTree.entries()].some(([rel, content]) =>
                !initialSnapshot.has(rel) || initialSnapshot.get(rel) !== content
            ) ||
            [...initialSnapshot.keys()].some(rel => !currentTree.has(rel));
        if (hasChanges) {
            logLine(`[gpt-agent] finish() not called after ${turnCount} turns — salvaging workspace (phase: ${phase})`);
            implementationJson = await salvageWorkspace(workspaceDir, initialSnapshot, wsId, ticketId);
            logLine(`[gpt-agent] salvaged: ${implementationJson.diff_summary}`);
        } else {
            throw new Error(
                `GPT agent did not call finish() after ${turnCount} turns and wrote no files. Phase at exit: ${phase}. See log at ${opts.liveLogPath ?? 'N/A'}.`
            );
        }
    }

    return implementationJson;
}
