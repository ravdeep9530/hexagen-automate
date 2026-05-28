import { promises as fs } from 'fs';
import { createWriteStream, WriteStream } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

import type { FileChange, ImplementationJson } from './agentImplementationService';

export type SandboxLanguage = 'python' | 'node' | 'mixed' | 'unknown';

export interface SandboxResult {
    language: SandboxLanguage;
    ran: boolean;          // false = we couldn't run any tests (e.g. unsupported language)
    passed: boolean;       // true only if every gate we ran exited 0
    test_count?: number;   // best-effort parse from runner output
    failure_count?: number;
    duration_ms: number;
    stdout: string;
    stderr: string;
    exit_code: number | null;
    note?: string;         // human-readable explanation
    gates?: GateResult[];  // per-step results (typecheck, build, test)
}

export interface GateResult {
    name: string;             // 'pytest', 'tsc', 'next-build', 'npm-test', etc.
    passed: boolean;
    exit_code: number | null;
    duration_ms: number;
    note?: string;
}

interface RunCommandResult {
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
    duration_ms: number;
}

function runCommand(
    cmd: string,
    args: string[],
    cwd: string,
    timeoutMs = 60000,
    extraEnv: Record<string, string> = {},
    liveTee?: { write: (chunk: string) => void } | null,
): Promise<RunCommandResult> {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const start = Date.now();
        const child = spawn(cmd, args, {
            cwd,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', CI: '1', ...extraEnv },
        });
        const timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGKILL'); } catch { /* noop */ }
        }, timeoutMs);

        child.stdout.on('data', (d: Buffer) => {
            const s = d.toString('utf8');
            stdout += s;
            liveTee?.write(s);
        });
        child.stderr.on('data', (d: Buffer) => {
            const s = d.toString('utf8');
            stderr += s;
            liveTee?.write(s);
        });
        child.on('error', (e) => {
            const msg = `\n[spawn error] ${e.message}`;
            stderr += msg;
            liveTee?.write(msg);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code, timedOut, duration_ms: Date.now() - start });
        });
    });
}

function detectLanguage(files: FileChange[]): SandboxLanguage {
    const exts = new Set<string>();
    for (const f of files) {
        const ext = (path.extname(f.path || '') || '').toLowerCase();
        if (ext) exts.add(ext);
    }
    const hasPy = exts.has('.py');
    const hasNode = exts.has('.ts') || exts.has('.tsx') || exts.has('.js') || exts.has('.jsx') || exts.has('.mjs');
    if (hasPy && !hasNode) return 'python';
    if (hasNode && !hasPy) return 'node';
    if (hasPy && hasNode) return 'mixed';
    return 'unknown';
}

function isTestFile(p: string): boolean {
    return /test|spec|__tests__/i.test(p);
}

async function writeImplToDisk(rootDir: string, impl: ImplementationJson): Promise<string[]> {
    const written: string[] = [];
    for (const f of impl.files_changed || []) {
        if (!f.path || f.action === 'delete') continue;
        const full = path.join(rootDir, f.path);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f.contents ?? '', 'utf8');
        written.push(f.path);
    }
    return written;
}

// ─── Python ───────────────────────────────────────────────────────────────────

function parsePytestSummary(out: string): { tests: number; failures: number } | null {
    const lastLine = out.trim().split(/\n/).reverse().find(l => /=+\s.*=+$/.test(l));
    if (!lastLine) return null;
    const passed = /(\d+)\s+passed/.exec(lastLine)?.[1];
    const failed = /(\d+)\s+failed/.exec(lastLine)?.[1];
    const errored = /(\d+)\s+error/.exec(lastLine)?.[1];
    const skipped = /(\d+)\s+skipped/.exec(lastLine)?.[1];
    const p = passed ? parseInt(passed, 10) : 0;
    const f = failed ? parseInt(failed, 10) : 0;
    const e = errored ? parseInt(errored, 10) : 0;
    const s = skipped ? parseInt(skipped, 10) : 0;
    if (p + f + e + s === 0) return null;
    return { tests: p + f + e + s, failures: f + e };
}

async function runPython(sandboxDir: string, impl: ImplementationJson, timeoutMs: number, ctx: SandboxGateContext): Promise<SandboxResult> {
    const t0 = Date.now();
    // Ensure every directory containing a python test file has __init__.py
    for (const f of impl.files_changed || []) {
        if (f.path?.endsWith('.py') && isTestFile(f.path)) {
            const dir = path.dirname(path.join(sandboxDir, f.path));
            try { await fs.writeFile(path.join(dir, '__init__.py'), '', { flag: 'wx' }); } catch { /* exists */ }
        }
    }
    // Write a conftest.py that adds the project root, common source roots (src/,
    // app/, lib/), AND every directory that contains non-test Python files to
    // sys.path. This covers all import patterns the agent might generate:
    //   from image_processing import …   (sibling in same dir)
    //   from utils.image_processing import …   (from src/ root)
    //   from src.utils.image_processing import …   (from project root)
    const conftestPath = path.join(sandboxDir, 'conftest.py');
    await fs.writeFile(conftestPath, `\
import sys, os

_root = os.path.dirname(os.path.abspath(__file__))
_skip = {'node_modules', '__pycache__', '.venv', 'venv', '.git', 'dist', 'build', '.next'}

# Always include project root and common sub-roots
sys.path.insert(0, _root)
for _sub in ('src', 'app', 'lib', 'backend', 'api'):
    _d = os.path.join(_root, _sub)
    if os.path.isdir(_d):
        sys.path.insert(0, _d)

# Add every directory that contains at least one non-test Python source file
for _dp, _dns, _fns in os.walk(_root):
    _dns[:] = [d for d in _dns if d not in _skip and not d.startswith('.')]
    if any(f.endswith('.py') and not f.startswith('test_') and f != 'conftest.py' for f in _fns):
        if _dp not in sys.path:
            sys.path.insert(0, _dp)
`);

    const pyTests = (impl.files_changed || [])
        .filter(f => f.path?.endsWith('.py') && isTestFile(f.path))
        .map(f => f.path!);
    if (pyTests.length === 0) {
        return {
            language: 'python', ran: false, passed: false,
            duration_ms: Date.now() - t0,
            stdout: '', stderr: '', exit_code: null,
            note: 'no python test files detected',
        };
    }
    ctx.log(`\n=== gate: test (pytest) ===\n`);
    await ctx.onGate?.('test');
    const { stdout, stderr, code, timedOut } = await runCommand(
        'python3',
        ['-m', 'pytest', '-q', '--no-header', '-x', '--tb=short', ...pyTests],
        sandboxDir,
        timeoutMs,
        {},
        ctx.tee,
    );
    const summary = parsePytestSummary(stdout + '\n' + stderr);
    return {
        language: 'python',
        ran: true,
        passed: code === 0 && !timedOut,
        test_count: summary?.tests,
        failure_count: summary?.failures,
        duration_ms: Date.now() - t0,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        exit_code: code,
        note: timedOut ? 'sandbox timed out' : undefined,
        gates: [{ name: 'pytest', passed: code === 0 && !timedOut, exit_code: code, duration_ms: Date.now() - t0 }],
    };
}

// ─── Node / TypeScript ────────────────────────────────────────────────────────

const NPM_CACHE_DIR = process.env.SANDBOX_NPM_CACHE || '/var/cache/agent-npm';

async function detectNodePackageManager(sandboxDir: string): Promise<'npm' | 'pnpm' | 'yarn'> {
    try { await fs.access(path.join(sandboxDir, 'pnpm-lock.yaml')); return 'pnpm'; } catch { /* nope */ }
    try { await fs.access(path.join(sandboxDir, 'yarn.lock')); return 'yarn'; } catch { /* nope */ }
    return 'npm';
}

type GateName = 'install' | 'typecheck' | 'build' | 'test' | 'smoke';

interface SandboxGateContext {
    tee: { write: (chunk: string) => void } | null;
    onGate?: (gate: GateName) => void | Promise<void>;
    log: (line: string) => void;
}

async function runNode(sandboxDir: string, impl: ImplementationJson, timeoutMs: number, ctx: SandboxGateContext): Promise<SandboxResult> {
    const t0 = Date.now();
    const gates: GateResult[] = [];
    const combinedStdout: string[] = [];
    const combinedStderr: string[] = [];

    // We can only run the Node toolchain if there's a package.json — without one,
    // the implementation isn't a buildable project, just loose files.
    type Pkg = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const pkgPath = path.join(sandboxDir, 'package.json');
    let pkg: Pkg;
    try {
        pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as Pkg;
    } catch {
        return {
            language: 'node', ran: false, passed: false,
            duration_ms: Date.now() - t0,
            stdout: '', stderr: '', exit_code: null,
            note: 'no package.json in implementation — cannot run Node toolchain',
        };
    }

    const pm = await detectNodePackageManager(sandboxDir);
    await fs.mkdir(NPM_CACHE_DIR, { recursive: true }).catch(() => { /* ignore */ });

    // 1. install — shared cache to avoid 200MB/attempt downloads.
    const installArgs = pm === 'npm'
        ? ['install', '--no-audit', '--no-fund', '--prefer-offline', '--cache', NPM_CACHE_DIR]
        : pm === 'pnpm'
        ? ['install', '--prefer-offline', '--store-dir', path.join(NPM_CACHE_DIR, 'pnpm-store')]
        : ['install', '--prefer-offline', '--cache-folder', path.join(NPM_CACHE_DIR, 'yarn-cache')];

    ctx.log(`\n=== gate: install (${pm}) ===\n`);
    await ctx.onGate?.('install');
    const install = await runCommand(pm, installArgs, sandboxDir, Math.min(timeoutMs, 180000), {}, ctx.tee);
    gates.push({ name: `${pm}-install`, passed: install.code === 0 && !install.timedOut, exit_code: install.code, duration_ms: install.duration_ms, note: install.timedOut ? 'timed out' : undefined });
    combinedStdout.push(`\n--- ${pm} install ---\n` + install.stdout);
    combinedStderr.push(install.stderr);
    if (install.code !== 0 || install.timedOut) {
        return finishNode(t0, gates, combinedStdout, combinedStderr, install.code, `${pm} install failed`);
    }

    // 2. typecheck — only if tsconfig.json exists. Run via npx so we use the
    //    repo's own typescript version, not whatever is on the global PATH.
    const hasTs = await fs.access(path.join(sandboxDir, 'tsconfig.json')).then(() => true).catch(() => false);
    if (hasTs) {
        ctx.log(`\n=== gate: typecheck (tsc --noEmit) ===\n`);
        await ctx.onGate?.('typecheck');
        const tsc = await runCommand('npx', ['--no-install', 'tsc', '--noEmit'], sandboxDir, 120000, {}, ctx.tee);
        gates.push({ name: 'tsc-noEmit', passed: tsc.code === 0 && !tsc.timedOut, exit_code: tsc.code, duration_ms: tsc.duration_ms, note: tsc.timedOut ? 'timed out' : undefined });
        combinedStdout.push('\n--- tsc --noEmit ---\n' + tsc.stdout);
        combinedStderr.push(tsc.stderr);
        if (tsc.code !== 0) {
            return finishNode(t0, gates, combinedStdout, combinedStderr, tsc.code, 'typecheck failed');
        }
    }

    // 3. build — if a `build` script exists. For Next.js this is `next build`;
    //    for libraries it's typically `tsc -p .`.
    if (pkg.scripts?.build) {
        ctx.log(`\n=== gate: build (${pm} run build) ===\n`);
        await ctx.onGate?.('build');
        const build = await runCommand(pm, ['run', 'build'], sandboxDir, 240000, {
            NEXT_TELEMETRY_DISABLED: '1',
        }, ctx.tee);
        gates.push({ name: `${pm}-build`, passed: build.code === 0 && !build.timedOut, exit_code: build.code, duration_ms: build.duration_ms, note: build.timedOut ? 'timed out' : undefined });
        combinedStdout.push(`\n--- ${pm} run build ---\n` + build.stdout);
        combinedStderr.push(build.stderr);
        if (build.code !== 0) {
            return finishNode(t0, gates, combinedStdout, combinedStderr, build.code, 'build failed');
        }
    }

    // 4. test — if a `test` script exists. Pass CI=1 so vitest/jest don't watch.
    if (pkg.scripts?.test && !/no test specified/i.test(pkg.scripts.test)) {
        ctx.log(`\n=== gate: test (${pm} test) ===\n`);
        await ctx.onGate?.('test');
        const test = await runCommand(pm, ['test', '--', '--run'], sandboxDir, 120000, {}, ctx.tee);
        gates.push({ name: `${pm}-test`, passed: test.code === 0 && !test.timedOut, exit_code: test.code, duration_ms: test.duration_ms, note: test.timedOut ? 'timed out' : undefined });
        combinedStdout.push(`\n--- ${pm} test ---\n` + test.stdout);
        combinedStderr.push(test.stderr);
        if (test.code !== 0) {
            return finishNode(t0, gates, combinedStdout, combinedStderr, test.code, 'unit tests failed');
        }
    }

    // 5. smoke-start — boot the app for a few seconds and confirm it doesn't
    //    crash on startup. Catches runtime errors (MODULE_NOT_FOUND, missing
    //    peer deps, broken next.config, etc.) that build+test don't surface.
    //    Only runs when there's a dev/start script.
    if (pkg.scripts?.dev || pkg.scripts?.start) {
        ctx.log(`\n=== gate: smoke (${pm} run ${pkg.scripts.dev ? 'dev' : 'start'}) ===\n`);
        await ctx.onGate?.('smoke');
        const smoke = await smokeStart(sandboxDir, pm, pkg.scripts.dev ? 'dev' : 'start', ctx.tee);
        gates.push({
            name: 'smoke-start',
            passed: smoke.passed,
            exit_code: smoke.exit_code,
            duration_ms: smoke.duration_ms,
            note: smoke.note,
        });
        if (smoke.stdout) combinedStdout.push(`\n--- smoke start ---\n${smoke.stdout}`);
        if (smoke.stderr) combinedStderr.push(smoke.stderr);
        if (!smoke.passed) {
            return finishNode(t0, gates, combinedStdout, combinedStderr, smoke.exit_code, 'app crashed on startup');
        }
    }

    return finishNode(t0, gates, combinedStdout, combinedStderr, 0, undefined);
}

/**
 * Briefly start the generated app via its dev/start script and confirm it
 * either binds to its port or stays alive for ~5s without crashing. We don't
 * actually probe the port (no curl in the sandbox image and racy on slow
 * boots) — instead we treat an early `exit` as failure and a still-running
 * process after the window as success.
 */
async function smokeStart(
    sandboxDir: string,
    pm: 'npm' | 'pnpm' | 'yarn',
    script: 'dev' | 'start',
    liveTee?: { write: (chunk: string) => void } | null,
): Promise<{ passed: boolean; exit_code: number | null; duration_ms: number; stdout: string; stderr: string; note?: string }> {
    return new Promise((resolve) => {
        const t0 = Date.now();
        // Pick an ephemeral port the dev server is unlikely to collide on.
        const port = 30000 + Math.floor(Math.random() * 20000);
        const args = script === 'dev'
            ? (pm === 'npm' ? ['run', 'dev', '--', '-p', String(port)] : ['run', 'dev', '--', '-p', String(port)])
            : ['start'];
        const proc = spawn(pm, args, {
            cwd: sandboxDir,
            env: { ...process.env, CI: '1', PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1' },
        });
        let stdout = '';
        let stderr = '';
        let earlyExitCode: number | null = null;
        let resolved = false;
        proc.stdout.on('data', (d: Buffer) => { const s = d.toString('utf8'); stdout += s; liveTee?.write(s); });
        proc.stderr.on('data', (d: Buffer) => { const s = d.toString('utf8'); stderr += s; liveTee?.write(s); });
        proc.on('exit', (code) => {
            earlyExitCode = code;
            if (!resolved) {
                resolved = true;
                // Crashed within the window — failure.
                resolve({
                    passed: false,
                    exit_code: code,
                    duration_ms: Date.now() - t0,
                    stdout: stdout.slice(-2000),
                    stderr: stderr.slice(-2000),
                    note: `app exited within smoke window with code ${code}`,
                });
            }
        });
        proc.on('error', (e) => {
            if (resolved) return;
            resolved = true;
            resolve({
                passed: false, exit_code: null, duration_ms: Date.now() - t0,
                stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) + `\n[spawn error] ${e.message}`,
                note: 'spawn failed',
            });
        });
        // Hold the window open for 6s. If the process is still alive at the
        // end of the window, we treat the smoke test as passed.
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { proc.kill('SIGTERM'); } catch { /* */ }
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, 2000);
            resolve({
                passed: earlyExitCode === null,
                exit_code: earlyExitCode,
                duration_ms: Date.now() - t0,
                stdout: stdout.slice(-2000),
                stderr: stderr.slice(-2000),
                note: 'app stayed alive through smoke window',
            });
        }, 6000);
    });
}

function finishNode(
    t0: number,
    gates: GateResult[],
    out: string[],
    err: string[],
    exitCode: number | null,
    note: string | undefined,
): SandboxResult {
    const passed = gates.every(g => g.passed);
    return {
        language: 'node',
        ran: gates.length > 0,
        passed,
        duration_ms: Date.now() - t0,
        stdout: out.join('').slice(-4000),
        stderr: err.join('').slice(-4000),
        exit_code: exitCode,
        gates,
        note: note ?? (passed ? undefined : 'one or more gates failed'),
    };
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function runImplementationTests(
    impl: ImplementationJson,
    opts: {
        runId?: string;
        attempt?: number;
        timeoutMs?: number;
        existingTree?: Record<string, string>;
        liveLogPath?: string;
        onGate?: (gate: GateName) => void | Promise<void>;
    } = {},
): Promise<SandboxResult> {
    const t0 = Date.now();
    const language = detectLanguage(impl.files_changed || []);

    const sandboxDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `agent-sandbox-${opts.runId ?? 'norun'}-${opts.attempt ?? 0}-`),
    );

    // Open the live-log file so every gate's stdout/stderr is appended to it
    // as it runs (the UI polls this via /api/pipelines/:run_id/sandbox-logs).
    let logStream: WriteStream | null = null;
    if (opts.liveLogPath) {
        try {
            await fs.mkdir(path.dirname(opts.liveLogPath), { recursive: true });
            logStream = createWriteStream(opts.liveLogPath, { flags: 'a' });
            logStream.write(`\n========== attempt ${opts.attempt ?? '?'} starting at ${new Date().toISOString()} ==========\n`);
        } catch (e) {
            console.warn('[sandbox] could not open live log:', e);
        }
    }
    const tee = logStream
        ? { write: (chunk: string) => { try { logStream!.write(chunk); } catch { /* dead stream */ } } }
        : null;
    const ctx: SandboxGateContext = {
        tee,
        onGate: opts.onGate,
        log: (line) => { tee?.write(line); },
    };

    try {
        // If we've been given an existingTree (e.g. accumulated files from
        // earlier tickets in the same sprint), lay it down first, then
        // overlay this attempt's files on top.
        if (opts.existingTree) {
            for (const [p, contents] of Object.entries(opts.existingTree)) {
                const full = path.join(sandboxDir, p);
                await fs.mkdir(path.dirname(full), { recursive: true });
                await fs.writeFile(full, contents, 'utf8');
            }
        }
        await writeImplToDisk(sandboxDir, impl);

        if (language === 'python' || language === 'mixed') {
            // mixed: run python tests; node gates would need a package.json
            // anyway, so the runner gracefully no-ops on the node side.
            return await runPython(sandboxDir, impl, opts.timeoutMs ?? 60000, ctx);
        }
        if (language === 'node') {
            return await runNode(sandboxDir, impl, opts.timeoutMs ?? 360000, ctx);
        }
        return {
            language, ran: false, passed: false,
            duration_ms: Date.now() - t0,
            stdout: '', stderr: '', exit_code: null,
            note: 'no recognised language in files_changed',
        };
    } finally {
        // Best-effort cleanup. node_modules can be large — fire-and-forget.
        fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
        try { logStream?.end(); } catch { /* ignore */ }
    }
}
