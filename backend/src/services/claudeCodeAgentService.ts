/**
 * Claude Code-style agentic implementation loop.
 *
 * Instead of asking an LLM to produce all files in one JSON blob (Dify style),
 * this service gives Claude a set of real tools — read_file, write_file,
 * list_files, bash, finish — and lets it iterate:
 *
 *   list files → read context → write code → run tsc/pytest/npm test →
 *   fix errors → run tests again → call finish() when passing
 *
 * The agent operates in a real workspace directory (copied from the accumulated
 * tree). When it calls finish(), we diff the workspace vs the initial state to
 * produce the ImplementationJson.
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { ImplementationJson, FileChange } from './agentImplementationService';

const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || '50', 10);
const WRAP_UP_TURNS_REMAINING = 6;
const BASH_TIMEOUT_MS = parseInt(process.env.AGENT_BASH_TIMEOUT_MS || '120000', 10);
const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-6';

// Directories/files to skip when walking the workspace
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '__pycache__',
    '.venv', 'venv', 'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache']);

// Commands whose side-effects we won't allow
const BLOCKED_PATTERNS = [
    /rm\s+-[rf]{1,2}\s*\//,      // rm -rf / (anything outside working dir)
    /\bdd\b.*\/dev\//,
    /\bmkfs\b/,
    />\s*\/dev\/sd/,
    /\bsudo\b/,
    /\bchmod\s+[0-7]{3,4}\s+\//,
];

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
        if (p.test(command)) return `[BLOCKED] Command matches a blocked pattern and was not executed.`;
    }
    return new Promise((resolve) => {
        const proc = spawn('bash', ['-c', command], {
            cwd,
            env: {
                ...process.env,
                FORCE_COLOR: '0', NO_COLOR: '1',
                NEXT_TELEMETRY_DISABLED: '1',
                CI: '1',
            },
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

async function executeTool(
    name: string,
    input: Record<string, unknown>,
    workspaceDir: string,
): Promise<string> {
    try {
        switch (name) {
            case 'read_file': {
                const abs = await safePath(workspaceDir, String(input.path ?? ''));
                if (!abs) return '[ERROR] Path is outside the workspace.';
                return await fs.readFile(abs, 'utf8').catch(e => `[ERROR] ${e.message}`);
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
                try {
                    entries = await fs.readdir(abs, { withFileTypes: true });
                } catch (e) {
                    return `[ERROR] ${(e as Error).message}`;
                }
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

// ─── Tool definitions ─────────────────────────────────────────────────────────

function buildTools(): Anthropic.Tool[] {
    return [
        {
            name: 'list_files',
            description: 'List files and directories. Use this first to understand the project structure.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    path: { type: 'string', description: 'Directory path relative to workspace root (default: "." for root)' },
                },
            },
        },
        {
            name: 'read_file',
            description: 'Read the contents of a file. Always read existing files before modifying them.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                },
                required: ['path'],
            },
        },
        {
            name: 'write_file',
            description: 'Write or create a file. Use for implementation files AND test files.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    content: { type: 'string', description: 'Complete file content (not a diff or snippet)' },
                },
                required: ['path', 'content'],
            },
        },
        {
            name: 'bash',
            description: [
                'Run a shell command in the workspace directory. Use for:',
                '- Type checking: npx tsc --noEmit',
                '- Python tests: python3 -m pytest tests/ -x -q',
                '- Node tests: npm test (or npx vitest run, npx jest --no-coverage)',
                '- Install deps: npm install --no-audit --no-fund --legacy-peer-deps',
                '- Quick syntax check: node -c file.js, python3 -c "import ast; ast.parse(open(\"f.py\").read())"',
                '- Any other standard shell command',
                'All paths and file ops are scoped to the workspace directory.',
            ].join('\n'),
            input_schema: {
                type: 'object' as const,
                properties: {
                    command: { type: 'string', description: 'Shell command to run' },
                },
                required: ['command'],
            },
        },
        {
            name: 'finish',
            description: [
                'Submit the completed implementation. Call this ONLY when:',
                '1. All required files are written',
                '2. At least one test file (path contains test/spec/__tests__) exists',
                '3. Tests are passing (you confirmed this with bash)',
                '4. Type checking passes (for TypeScript projects)',
            ].join('\n'),
            input_schema: {
                type: 'object' as const,
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
    ];
}

// ─── Progress push helper ─────────────────────────────────────────────────────

export type AgentPhase =
    | 'exploring'    // reading files
    | 'writing'      // writing implementation
    | 'testing'      // running tests
    | 'fixing'       // addressing failures
    | 'finishing';   // calling finish()

function inferPhase(toolName: string, prevPhase: AgentPhase): AgentPhase {
    if (toolName === 'finish') return 'finishing';
    if (toolName === 'bash') return 'testing';
    if (toolName === 'write_file') return prevPhase === 'exploring' ? 'writing' : prevPhase;
    if (toolName === 'read_file' || toolName === 'list_files') {
        return prevPhase === 'testing' ? 'fixing' : 'exploring';
    }
    return prevPhase;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface AgentRunOptions {
    /** Called after each turn with a short status message for live progress display. */
    onProgress?: (turn: number, phase: AgentPhase, detail: string) => Promise<void> | void;
    /** Path to write a live log of tool calls + outputs. */
    liveLogPath?: string;
    /** Extra instructions appended to the system prompt (e.g. to override rules for fix runs). */
    systemPromptSuffix?: string;
}

/**
 * Run the Claude Code-style agentic loop for a single ticket.
 *
 * The agent operates in a temporary workspace directory seeded with
 * `existingTree` (accumulated files from prior tickets). It reads existing
 * files, writes new ones, runs tests via the bash tool, and calls finish()
 * when everything passes.
 *
 * Returns an ImplementationJson derived from the workspace diff.
 * Throws if the agent exhausts its turn budget without finishing.
 */
export async function runAgentForTicket(
    repo: string,
    ticket: unknown,
    designExcerpt: unknown,
    existingTree: Record<string, string>,
    runId: string | null,
    opts: AgentRunOptions = {},
): Promise<ImplementationJson> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — Claude Code agent unavailable');

    const anthropic = new Anthropic({ apiKey });

    // ── Set up workspace ──────────────────────────────────────────────────────
    const wsId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workspaceDir = path.join(DEPLOYMENTS_ROOT, runId ?? 'scratch', `agent-ws-${wsId}`);
    await fs.mkdir(workspaceDir, { recursive: true });

    // Seed with accumulated files from previous tickets
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

    // Snapshot initial state so we can diff at the end
    const initialSnapshot = new Map(Object.entries(existingTree));

    const liveLog = opts.liveLogPath
        ? { write: (s: string) => fs.appendFile(opts.liveLogPath!, s).catch(() => {}) }
        : null;

    const logLine = (s: string) => liveLog?.write(s + '\n');

    // ── Prompts ───────────────────────────────────────────────────────────────
    const ticketStr = typeof ticket === 'string' ? ticket : JSON.stringify(ticket, null, 2);
    const designStr = (typeof designExcerpt === 'string' ? designExcerpt : JSON.stringify(designExcerpt)).slice(0, 4000);

    const systemPrompt = `You are an expert software engineer implementing a development ticket.

You work in a real directory and have tools to read files, write files, run shell commands, and submit when done.

## Workflow
1. **Explore** — list_files to understand project structure, read_file for relevant existing code
2. **Implement** — write_file for all new/modified files (implementation + tests)
3. **Test** — bash to run the test suite (pytest / npm test / tsc --noEmit)
4. **Fix** — read errors, fix files, run tests again
5. **Finish** — call finish() only when tests pass

## Rules
- Read existing files before editing them — understand naming conventions and imports
- Write at least one test file (path must contain "test", "spec", or "__tests__")
- Tests must PASS before you call finish() — verify with bash
- **Match the test language/framework to the project tech stack:**
  - If \`package.json\` exists → the project is JavaScript/TypeScript. Write tests in TypeScript/JavaScript (.test.ts, .test.tsx, .spec.ts, .spec.js). Use the framework already in devDependencies (vitest, jest, @testing-library, etc.). NEVER write Python (.py) files for a JavaScript/TypeScript project.
  - If \`requirements.txt\`, \`setup.py\`, or \`pyproject.toml\` exists (and no package.json) → Python project. Write pytest tests.
  - If both exist → match the primary language of the ticket.
- For TypeScript projects: run \`npx tsc --noEmit\` and fix all type errors before finishing
- For Next.js projects (\`next.config.*\` exists): also run \`npm run build 2>&1 | tail -30\` — tsc alone misses React rendering errors. Fix ALL build errors before finishing.
- React component files that contain JSX MUST use \`.tsx\` extension (not \`.ts\`). Files with only TypeScript logic may use \`.ts\`.
- Next.js App Router page components must: use \`export default function\`, return \`JSX.Element\` (actual React JSX — not a controller or plain object), and include \`'use client'\` if they use hooks or browser APIs.
- Do NOT modify: package.json, package-lock.json, yarn.lock, tsconfig.json (unless creating from scratch)
- Run tests only for the files you wrote — not the entire test suite (other tickets may have pre-existing failures)
- branch_name: only [a-zA-Z0-9._/-] chars, format feat/<ticket-id>-<slug>
- commit_message: Conventional Commits, e.g. "feat(calc): add currency conversion"
- **Turn budget**: You have ${MAX_TURNS} turns total. When ${WRAP_UP_TURNS_REMAINING} or fewer turns remain, STOP iterating and call finish() immediately with your best work.

## Repo context
Repository: ${repo}`;

    const userMessage = `Implement this ticket:

\`\`\`json
${ticketStr}
\`\`\`

Technical design context:
\`\`\`
${designStr}
\`\`\``;

    // ── Agent loop ────────────────────────────────────────────────────────────
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
    const tools = buildTools();
    let turnCount = 0;
    let phase: AgentPhase = 'exploring';
    let implementationJson: ImplementationJson | null = null;
    let wrapUpInjected = false;

    logLine(`[agent] starting — workspace: ${workspaceDir}`);
    logLine(`[agent] model: ${AGENT_MODEL}, max turns: ${MAX_TURNS}`);

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
                logLine(`[agent turn ${turnCount}] injected wrap-up warning (${turnsRemaining} turns left)`);
            }

            const response = await anthropic.messages.create({
                model: AGENT_MODEL,
                max_tokens: 8192,
                system: systemPrompt,
                tools,
                messages,
                temperature: 0,
            });

            // Append assistant turn to history
            messages.push({ role: 'assistant', content: response.content });

            // Log any text the model emitted
            for (const block of response.content) {
                if (block.type === 'text' && block.text.trim()) {
                    logLine(`[agent turn ${turnCount}] ${block.text.slice(0, 300)}`);
                }
            }

            if (response.stop_reason === 'end_turn') {
                logLine(`[agent] stopped (end_turn) after ${turnCount} turns without calling finish()`);
                break;
            }
            if (response.stop_reason !== 'tool_use') break;

            // Execute all tool calls in this turn
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of response.content) {
                if (block.type !== 'tool_use') continue;

                const toolInput = block.input as Record<string, unknown>;
                phase = inferPhase(block.name, phase);

                logLine(`[tool:${block.name}] ${JSON.stringify(toolInput).slice(0, 200)}`);
                await opts.onProgress?.(turnCount, phase, `${block.name}(${Object.keys(toolInput).join(', ')})`);

                // ── finish() ─────────────────────────────────────────────────
                if (block.name === 'finish') {
                    const fi = toolInput as {
                        branch_name?: string;
                        commit_message?: string;
                        pr_title?: string;
                        pr_body_markdown?: string;
                        self_review_notes?: string[];
                    };

                    // Diff workspace vs initial snapshot
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
                        if (!currentTree.has(rel)) {
                            filesChanged.push({ path: rel, action: 'delete' });
                        }
                    }

                    const branchName = (fi.branch_name ?? `feat/ticket-${wsId}`).replace(/\s+/g, '-');

                    implementationJson = {
                        branch_name: branchName,
                        commit_message: fi.commit_message ?? `feat: implement ticket`,
                        files_changed: filesChanged,
                        diff_summary: `${filesChanged.filter(f => f.action === 'create').length} created, ` +
                            `${filesChanged.filter(f => f.action === 'modify').length} modified, ` +
                            `${filesChanged.filter(f => f.action === 'delete').length} deleted`,
                        test_files_added: testFilesAdded,
                        self_review_notes: fi.self_review_notes ?? [],
                        pr_title: fi.pr_title ?? branchName,
                        pr_body_markdown: fi.pr_body_markdown ?? '',
                    };

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: 'Implementation submitted successfully.',
                    });
                    logLine(`[agent] finish() called — ${filesChanged.length} file changes, ${testFilesAdded.length} test files added`);
                    break; // don't execute remaining tool calls in this turn
                }

                // ── other tools ───────────────────────────────────────────────
                const result = await executeTool(block.name, toolInput, workspaceDir);
                const resultPreview = result.slice(0, 500);
                logLine(`[result] ${resultPreview}${result.length > 500 ? '…' : ''}`);

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: result,
                });
            }

            if (toolResults.length > 0) {
                messages.push({ role: 'user', content: toolResults });
            }
        }
    } finally {
        // Clean up workspace after a successful run to save disk space.
        // Keep it on failure so humans can inspect what the agent wrote.
        if (implementationJson) {
            await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    // Salvage: if finish() was never called but files were written, collect them
    if (!implementationJson) {
        const currentTree = await walkWorkspace(workspaceDir);
        const hasChanges = currentTree.size > initialSnapshot.size ||
            [...currentTree.entries()].some(([k, v]) => initialSnapshot.get(k) !== v);

        if (hasChanges) {
            logLine(`[agent] finish() not called after ${turnCount} turns — salvaging workspace (phase: ${phase})`);
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
            const ticketObj = typeof ticket === 'object' && ticket !== null ? ticket as Record<string, unknown> : {};
            const ticketId = String(ticketObj.id ?? ticketObj.ticket_id ?? 'ticket');
            const slug = ticketId.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
            implementationJson = {
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
            logLine(`[agent] salvaged: ${implementationJson.diff_summary}`);
        } else {
            throw new Error(
                `Claude agent did not call finish() after ${turnCount} turns and wrote no files. ` +
                `Phase at exit: ${phase}. See log at ${opts.liveLogPath ?? 'N/A'}.`
            );
        }
    }

    return implementationJson;
}
