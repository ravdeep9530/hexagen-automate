import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { callAzureChat, isAzureConfigured } from '../config/azure';
import { verifyDeployedApp, type VerificationResult } from './browserVerificationService';

/** Emitted when a running deployment crashes and needs an agent fix. */
export const deployEvents = new EventEmitter();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
});

const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
const PORT_RANGE_START = parseInt(process.env.DEPLOY_PORT_START || '4100', 10);
const PORT_RANGE_END = parseInt(process.env.DEPLOY_PORT_END || '4199', 10);
const PUBLIC_HOST = process.env.DEPLOY_PUBLIC_HOST || 'localhost';
const SOURCE_DIR_NAME = 'source';
const LOG_FILE_NAME = 'run.log';

export type DeploymentStatus = 'starting' | 'installing' | 'running' | 'stopped' | 'failed' | 'crashed' | 'auto-fixing';
export type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface Deployment {
    run_id: string;
    status: DeploymentStatus;
    port: number | null;
    pid: number | null;
    url: string | null;
    work_dir: string | null;
    log_path: string | null;
    start_command: string | null;
    error: string | null;
    started_at: string;
    stopped_at: string | null;
    updated_at: string;
    verification_status: VerificationStatus | null;
    verification_result: VerificationResult | null;
}

// log-follower processes keyed by run_id (docker logs --follow).
const liveProcesses = new Map<string, ChildProcess>();

// ─── Docker helpers ───────────────────────────────────────────────────────────

function containerName(runId: string): string {
    return `sdlc-run-${runId.replace(/-/g, '').slice(0, 16)}`;
}
function imageName(runId: string): string {
    return `sdlc-img-${runId.replace(/-/g, '').slice(0, 16)}`;
}

async function dockerCmd(args: string[], logPath: string, timeoutMs = 10 * 60 * 1000): Promise<void> {
    await appendLog(logPath, `[deploy] docker ${args.join(' ')}\n`);
    await new Promise<void>((resolve, reject) => {
        const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const log = createWriteStream(logPath, { flags: 'a' });
        proc.stdout?.pipe(log, { end: false });
        proc.stderr?.pipe(log, { end: false });
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* */ }
            reject(new Error(`docker ${args[0]} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
        proc.on('close', (code) => {
            clearTimeout(timer);
            log.end();
            if (code === 0) resolve();
            else reject(new Error(`docker ${args[0]} exited ${code}`));
        });
        proc.on('error', (e) => { clearTimeout(timer); log.end(); reject(e); });
    });
}

interface ContainerSpec {
    name: string;           // e.g. "app", "frontend", "backend"
    dockerfile: string;     // path relative to workDir, e.g. "Dockerfile" or "frontend/Dockerfile"
    context: string;        // build context relative to workDir, e.g. "." or "frontend"
    port: number;           // container-internal port
}

interface DeployStrategy {
    containers: ContainerSpec[];
}

async function walkSourceFiles(dir: string, rel = '', depth = 0): Promise<string[]> {
    if (depth > 4) return [];
    const SKIP = new Set(['node_modules', '.next', 'dist', '.git', '__pycache__', '.venv', 'coverage']);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const result: string[] = [];
    for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            result.push(...await walkSourceFiles(path.join(dir, e.name), relPath, depth + 1));
        } else {
            result.push(relPath);
        }
    }
    return result;
}

async function aiDockerStrategy(workDir: string, logPath: string): Promise<DeployStrategy> {
    const files = await walkSourceFiles(workDir);

    // Read key config files for AI context
    const keyFiles = ['package.json', 'requirements.txt', 'frontend/package.json', 'backend/package.json',
        'frontend/requirements.txt', 'backend/requirements.txt', 'docker-compose.yml', 'pyproject.toml'];
    const snippets: string[] = [];
    for (const f of keyFiles) {
        try {
            const content = await fs.readFile(path.join(workDir, f), 'utf8');
            snippets.push(`=== ${f} ===\n${content.slice(0, 500)}`);
        } catch { /* not present */ }
    }

    const prompt = `You are a DevOps expert. Analyze this project structure and decide the Docker deployment strategy.

File tree:
${files.slice(0, 120).join('\n')}

Key config files:
${snippets.join('\n\n') || '(none found)'}

Rules:
- If there is a top-level package.json or requirements.txt with no backend/frontend split → single container named "app"
- If there are separate frontend/ and backend/ directories each with their own package.json or requirements.txt → two containers
- If already has a Dockerfile at root → single container, use it
- Container port: Node.js/Next.js = 3000, Python FastAPI/Flask = 8000, Django = 8000, Express = 3000
- dockerfile path is relative to workDir (e.g. "Dockerfile", "frontend/Dockerfile", "backend/Dockerfile")
- context path is relative to workDir (e.g. ".", "frontend", "backend")
- For multi-container, name them "frontend" and "backend"

Respond with ONLY valid JSON (no markdown):
{
  "containers": [
    { "name": "app", "dockerfile": "Dockerfile", "context": ".", "port": 3000 }
  ]
}`;

    if (isAzureConfigured()) {
        try {
            const raw = await callAzureChat([{ role: 'user', content: prompt }], 0.1);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(cleaned) as DeployStrategy;
            if (Array.isArray(parsed.containers) && parsed.containers.length > 0) {
                await appendLog(logPath, `[deploy] AI strategy: ${JSON.stringify(parsed.containers.map(c => c.name))}\n`);
                return parsed;
            }
        } catch (e) {
            await appendLog(logPath, `[deploy] AI strategy failed (${(e as Error).message}), falling back to heuristic\n`);
        }
    }

    // Heuristic fallback
    return heuristicDockerStrategy(workDir, files);
}

async function heuristicDockerStrategy(workDir: string, files: string[]): Promise<DeployStrategy> {
    const has = (f: string) => files.includes(f);

    // Multi-container: separate frontend + backend dirs each with own package.json/requirements
    const hasFePkg = has('frontend/package.json');
    const hasBePkg = has('backend/package.json') || has('backend/requirements.txt') || has('backend/main.py') || has('backend/app.py');
    if (hasFePkg && hasBePkg) {
        return {
            containers: [
                { name: 'frontend', dockerfile: 'frontend/Dockerfile', context: 'frontend', port: 3000 },
                { name: 'backend', dockerfile: 'backend/Dockerfile', context: 'backend', port: 8000 },
            ],
        };
    }

    // Single container
    const port = has('package.json') ? 3000 : 8000;
    return { containers: [{ name: 'app', dockerfile: 'Dockerfile', context: '.', port }] };
}

async function ensureDockerfile(workDir: string, spec: ContainerSpec): Promise<void> {
    const dfPath = path.join(workDir, spec.dockerfile);
    const exists = await fs.access(dfPath).then(() => true).catch(() => false);
    if (exists) return;

    await fs.mkdir(path.dirname(dfPath), { recursive: true });

    const contextDir = path.join(workDir, spec.context);

    // Search for package.json up to 2 levels deep (handles both root and nested structures)
    const findFile = async (name: string, maxDepth = 2): Promise<string | null> => {
        const check = async (dir: string, depth: number): Promise<string | null> => {
            const p = path.join(dir, name);
            if (await fs.access(p).then(() => true).catch(() => false)) return p;
            if (depth <= 0) return null;
            const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
            for (const e of entries) {
                if (!e.isDirectory() || ['node_modules', '.next', '.git', 'dist'].includes(e.name)) continue;
                const found = await check(path.join(dir, e.name), depth - 1);
                if (found) return found;
            }
            return null;
        };
        return check(contextDir, maxDepth);
    };

    // Check for TypeScript/JavaScript source files as fallback signal
    const hasTsOrJsx = async (): Promise<boolean> => {
        const files = await walkSourceFiles(contextDir, '', 3);
        return files.some(f => f.endsWith('.tsx') || f.endsWith('.jsx') ||
            (f.endsWith('.ts') && !f.endsWith('.d.ts')) || f.endsWith('.js'));
    };

    const pkgPath = await findFile('package.json');
    if (pkgPath) {
        const pkgRaw = await fs.readFile(pkgPath, 'utf8').catch(() => '{}');
        const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string>; dependencies?: Record<string, string> };
        const isNext = !!(pkg.dependencies?.next || pkg.scripts?.dev?.includes('next') ||
            pkg.scripts?.build?.includes('next'));
        const devCmd = isNext
            ? `CMD ["npx", "next", "dev", "-p", "${spec.port}"]`
            : `CMD ["npm", "run", "dev"]`;
        await fs.writeFile(dfPath, [
            'FROM node:18-alpine',
            'WORKDIR /app',
            'COPY package*.json ./',
            'RUN npm install --no-audit --no-fund --legacy-peer-deps',
            'COPY . .',
            'ENV NODE_ENV=development',
            'ENV NEXT_TELEMETRY_DISABLED=1',
            `ENV PORT=${spec.port}`,
            `EXPOSE ${spec.port}`,
            devCmd,
        ].join('\n'), 'utf8');
        return;
    }

    // Python entry points
    const reqPath = await findFile('requirements.txt');
    const hasReqs = !!reqPath;
    const reqLine = hasReqs ? 'COPY requirements.txt ./\nRUN pip install -r requirements.txt --no-cache-dir' : '';
    for (const entry of ['main.py', 'app.py', 'server.py', 'run.py']) {
        const entryPath = await findFile(entry);
        if (!entryPath) continue;
        const src = await fs.readFile(entryPath, 'utf8').catch(() => '');
        const mod = entry.replace('.py', '');
        const isFastApi = src.includes('FastAPI') || src.includes('fastapi');
        const isDjango = await fs.access(path.join(contextDir, 'manage.py')).then(() => true).catch(() => false);
        if (isDjango) {
            await fs.writeFile(dfPath, [
                'FROM python:3.11-slim', 'WORKDIR /app', reqLine, 'COPY . .',
                `EXPOSE ${spec.port}`, `CMD ["python3", "manage.py", "runserver", "0.0.0.0:${spec.port}"]`,
            ].filter(Boolean).join('\n'), 'utf8');
        } else {
            await fs.writeFile(dfPath, [
                'FROM python:3.11-slim', 'WORKDIR /app', reqLine, 'COPY . .',
                `EXPOSE ${spec.port}`,
                isFastApi
                    ? `CMD ["python3", "-m", "uvicorn", "${mod}:app", "--host", "0.0.0.0", "--port", "${spec.port}", "--reload"]`
                    : `CMD ["python3", "${entry}"]`,
            ].filter(Boolean).join('\n'), 'utf8');
        }
        return;
    }

    // Last resort: if there are TS/JSX files assume Next.js, generate a package.json + Dockerfile
    if (await hasTsOrJsx()) {
        const pkgJson = {
            name: 'deployed-app', version: '1.0.0', private: true,
            scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
            dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
        };
        // tsconfig.json with @/* → ./src/* alias so AI-generated imports like
        // `import Foo from "@/features/foo/Foo"` resolve correctly.
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
        await fs.writeFile(path.join(contextDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
        // Only write tsconfig.json if one doesn't already exist
        const tsconfigPath = path.join(contextDir, 'tsconfig.json');
        const hasTsconfig = await fs.access(tsconfigPath).then(() => true).catch(() => false);
        if (!hasTsconfig) {
            await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');
        }
        await fs.writeFile(dfPath, [
            'FROM node:18-alpine', 'WORKDIR /app',
            'COPY package*.json tsconfig*.json ./',
            'RUN npm install --no-audit --no-fund --legacy-peer-deps',
            'COPY . .',
            'ENV NODE_ENV=development', 'ENV NEXT_TELEMETRY_DISABLED=1',
            `ENV PORT=${spec.port}`, `EXPOSE ${spec.port}`,
            `CMD ["npx", "next", "dev", "-p", "${spec.port}"]`,
        ].join('\n'), 'utf8');
        return;
    }

    throw new Error(`cannot detect project type for container "${spec.name}" in ${spec.context} — no package.json, Python entry point, or TS/JSX files found`);
}

async function runVerificationAndStore(runId: string, port: number, logPath: string): Promise<void> {
    await pool.query(
        `UPDATE pipeline_deployments SET verification_status = 'running' WHERE run_id = $1`,
        [runId]
    );
    const result = await verifyDeployedApp(runId, port, logPath);
    await pool.query(
        `UPDATE pipeline_deployments
           SET verification_status = $2, verification_result = $3::jsonb
         WHERE run_id = $1`,
        [runId, result.passed ? 'passed' : 'failed', JSON.stringify(result)]
    );
}

/** Manually re-trigger browser verification for a deployment that is already running. */
export async function runVerification(runId: string): Promise<{ queued: boolean; reason?: string }> {
    const dep = await getDeployment(runId);
    if (!dep) return { queued: false, reason: 'deployment not found' };
    if (dep.status !== 'running') return { queued: false, reason: `deployment is not running (status=${dep.status})` };
    if (!dep.port) return { queued: false, reason: 'no port recorded' };
    const logPath = dep.log_path ?? path.join(DEPLOYMENTS_ROOT, runId, LOG_FILE_NAME);
    const port = dep.port;
    runVerificationAndStore(runId, port, logPath).catch(e =>
        console.error(`[verify] manual re-trigger crashed for ${runId}:`, e)
    );
    return { queued: true };
}

// ─── Crash detection & auto-fix ───────────────────────────────────────────────

const CRASH_PATTERNS = [
    // Build-time failures
    /Module not found: (Error: )?Can't resolve/,
    /Failed to compile/,
    /Build error occurred/,
    /error TS\d+:/,
    /Cannot find module/,
    /SyntaxError:/,
    /npm ERR!/,
    // Runtime / Next.js errors
    /Attempted to call .+ from the server but .+ is on the client/,
    /\bUnhandledPromiseRejection/,
    /\bunhandledRejection\b/i,
    /Error: ENOENT: no such file/,
    /FATAL ERROR/,
    // HTTP 5XX responses in the app log (Next.js dev server format)
    / (GET|POST|PUT|DELETE|PATCH) \S+ 5\d\d /,
];

/** Extract a short crash excerpt from the log. Returns null if no crash found. */
async function detectCrashExcerpt(logPath: string): Promise<string | null> {
    const content = await fs.readFile(logPath, 'utf8').catch(() => '');
    if (!content) return null;
    const lines = content.split('\n');
    const errorLines: string[] = [];
    for (const line of lines) {
        if (CRASH_PATTERNS.some(p => p.test(line))) errorLines.push(line);
    }
    if (errorLines.length === 0) return null;
    // Return up to 40 lines of context around the first crash indicator
    const firstIdx = lines.findIndex(l => CRASH_PATTERNS.some(p => p.test(l)));
    return lines.slice(Math.max(0, firstIdx - 2), firstIdx + 38).join('\n');
}

/** Check if the named container is still running. */
async function isContainerRunning(cname: string): Promise<boolean> {
    return new Promise(resolve => {
        const p = spawn('docker', ['inspect', '--format', '{{.State.Running}}', cname], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        p.on('close', () => resolve(out.trim() === 'true'));
        p.on('error', () => resolve(false));
    });
}

/**
 * Scan for crash patterns 45 s after deployment starts.
 * 45 s gives Next.js time to attempt compilation — most crashes surface within 30 s.
 */
function scheduleCrashScan(runId: string, logPath: string): void {
    setTimeout(async () => {
        try {
            const dep = await getDeployment(runId);
            if (!dep || dep.status !== 'running') return; // already stopped/failed/auto-fixing
            const excerpt = await detectCrashExcerpt(logPath);
            if (!excerpt) return;
            console.log(`[deploymentService] crash pattern detected for ${runId}, marking crashed`);
            const res = await pool.query(
                `UPDATE pipeline_deployments SET status = 'crashed', error = $2, stopped_at = now()
                   WHERE run_id = $1 AND status = 'running'
                   RETURNING run_id`,
                [runId, excerpt.slice(0, 2000)]
            );
            if (res.rowCount && res.rowCount > 0) {
                deployEvents.emit('crashed', runId, excerpt);
            }
        } catch (e) {
            console.error(`[deploymentService] crash scan failed for ${runId}:`, e);
        }
    }, 45_000);
}

/**
 * Called when the docker log follower closes with a non-zero exit code.
 * Waits briefly then checks the log and fires the crashed event.
 */
function schedulePostCrashFix(runId: string, logPath: string, cname: string): void {
    setTimeout(async () => {
        try {
            const running = await isContainerRunning(cname);
            if (running) return; // restarted on its own
            const content = await fs.readFile(logPath, 'utf8').catch(() => '');
            const lines = content.split('\n');
            const excerpt = lines.slice(-60).join('\n');
            const res = await pool.query(
                `UPDATE pipeline_deployments SET status = 'crashed', error = $2, stopped_at = now()
                   WHERE run_id = $1 AND status IN ('running','starting','installing')
                   RETURNING run_id`,
                [runId, excerpt.slice(0, 2000)]
            );
            if (res.rowCount && res.rowCount > 0) {
                deployEvents.emit('crashed', runId, excerpt);
            }
        } catch (e) {
            console.error(`[deploymentService] post-crash handler failed for ${runId}:`, e);
        }
    }, 3_000);
}

/** Mark a deployment as auto-fixing (called by the fix agent runner). */
export async function markDeploymentAutoFixing(runId: string): Promise<void> {
    await pool.query(
        `UPDATE pipeline_deployments SET status = 'auto-fixing', stopped_at = NULL
           WHERE run_id = $1`,
        [runId]
    );
}

export async function initializeDeploymentTables(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pipeline_deployments (
            run_id          UUID PRIMARY KEY REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
            status          TEXT NOT NULL,
            port            INTEGER,
            pid             INTEGER,
            url             TEXT,
            work_dir        TEXT,
            log_path        TEXT,
            start_command   TEXT,
            error           TEXT,
            started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            stopped_at      TIMESTAMPTZ,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pipeline_deployments_status ON pipeline_deployments (status)`);
    // Verification columns — add if not present (idempotent backfill)
    await pool.query(`ALTER TABLE pipeline_deployments ADD COLUMN IF NOT EXISTS verification_status TEXT`);
    await pool.query(`ALTER TABLE pipeline_deployments ADD COLUMN IF NOT EXISTS verification_result JSONB`);
    await pool.query(`
        CREATE OR REPLACE FUNCTION notify_pipeline_deployment_event() RETURNS trigger AS $$
        BEGIN
          NEW.updated_at = now();
          PERFORM pg_notify('pipeline_event', NEW.run_id::text);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    await pool.query(`DROP TRIGGER IF EXISTS trg_pipeline_deployments_notify ON pipeline_deployments`);
    await pool.query(`
        CREATE TRIGGER trg_pipeline_deployments_notify
          BEFORE INSERT OR UPDATE ON pipeline_deployments
          FOR EACH ROW EXECUTE FUNCTION notify_pipeline_deployment_event()
    `);

    // On boot, reconcile rows that were in-flight when the backend died.
    // Docker containers survive restarts (--restart unless-stopped), so check
    // each container before marking stopped.
    const inFlight = await pool.query(
        `SELECT run_id FROM pipeline_deployments WHERE status IN ('starting','installing','running')`
    );
    let reconciledCount = 0;
    for (const row of inFlight.rows) {
        const runId: string = row.run_id;
        const shortId = runId.replace(/-/g, '').slice(0, 16);
        const cname = `sdlc-run-${shortId}`;
        const stillRunning = await isContainerRunning(cname);
        if (stillRunning) {
            // Container is still up — restore the log follower so the UI gets live logs
            const dep = await pool.query(
                `SELECT port, log_path FROM pipeline_deployments WHERE run_id = $1`, [runId]
            );
            if (dep.rows[0]) {
                const { port, log_path } = dep.rows[0];
                const logPath = log_path ?? path.join(DEPLOYMENTS_ROOT, runId, LOG_FILE_NAME);
                await pool.query(
                    `UPDATE pipeline_deployments SET status = 'running', stopped_at = NULL WHERE run_id = $1`, [runId]
                );
                console.log(`[deploymentService] reattached to running container ${cname} on port ${port}`);
                scheduleCrashScan(runId, logPath);
            }
        } else {
            await pool.query(
                `UPDATE pipeline_deployments
                   SET status = 'stopped', stopped_at = now(),
                       error = COALESCE(error, 'backend restarted, deployment process was lost')
                 WHERE run_id = $1`, [runId]
            );
            reconciledCount++;
        }
    }
    if (reconciledCount > 0) {
        console.log(`[deploymentService] reconciled ${reconciledCount} orphaned deployment rows after restart`);
    }
}

/** Returns the set of host ports currently bound by running Docker containers. */
async function getDockerBoundPorts(): Promise<Set<number>> {
    const bound = new Set<number>();
    return new Promise(resolve => {
        const proc = spawn('docker', ['ps', '--format', '{{.Ports}}'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout?.on('data', d => out += d.toString());
        proc.on('close', () => {
            // Each line looks like: 0.0.0.0:4101->3000/tcp, [::]:4101->3000/tcp
            for (const m of out.matchAll(/:(\d+)->/g)) bound.add(parseInt(m[1], 10));
            resolve(bound);
        });
        proc.on('error', () => resolve(bound));
    });
}

async function allocatePort(): Promise<number> {
    // Ports claimed in the DB by active deployments
    const dbTaken = new Set<number>();
    const r = await pool.query<{ port: number | null }>(
        `SELECT port FROM pipeline_deployments WHERE status IN ('starting','installing','running') AND port IS NOT NULL`
    );
    for (const row of r.rows) {
        if (row.port != null) dbTaken.add(row.port);
    }
    // Ports actually bound by Docker right now (catches stale containers not in DB)
    const dockerTaken = await getDockerBoundPorts();
    const taken = new Set([...dbTaken, ...dockerTaken]);

    for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
        if (!taken.has(p)) return p;
    }
    throw new Error(`no free port in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}


async function appendLog(logPath: string, line: string): Promise<void> {
    try { await fs.appendFile(logPath, line, 'utf8'); } catch { /* swallow */ }
}

/**
 * Read the tail of a deployment's log file. Returns at most `maxBytes` (default
 * 32 KB) of UTF-8 text, plus the next read offset so the frontend can poll
 * incrementally without re-streaming the whole file.
 */
export async function readDeploymentLog(
    runId: string,
    fromOffset = 0,
    maxBytes = 32 * 1024,
): Promise<{ content: string; offset: number; size: number }> {
    const dep = await getDeployment(runId);
    if (!dep || !dep.log_path) return { content: '', offset: 0, size: 0 };
    try {
        const stat = await fs.stat(dep.log_path);
        const size = stat.size;
        let start = Math.max(0, fromOffset);
        if (start > size) start = 0; // log was rotated/truncated — start fresh
        if (size - start > maxBytes) start = size - maxBytes; // bound to last maxBytes
        const fh = await fs.open(dep.log_path, 'r');
        try {
            const length = size - start;
            const buf = Buffer.alloc(length);
            await fh.read(buf, 0, length, start);
            return { content: buf.toString('utf8'), offset: size, size };
        } finally {
            await fh.close();
        }
    } catch {
        return { content: '', offset: 0, size: 0 };
    }
}

/**
 * Read the tail of a run's sandbox log (written by sandboxRunnerService as
 * gates execute). Same offset/maxBytes contract as readDeploymentLog so the
 * frontend can poll incrementally. Returns empty when no sandbox has run yet.
 */
export async function readFixAgentLog(
    runId: string,
    fromOffset = 0,
    maxBytes = 64 * 1024,
): Promise<{ content: string; offset: number; size: number }> {
    return readLogFile(path.join(DEPLOYMENTS_ROOT, runId, 'fix-agent.log'), fromOffset, maxBytes);
}

async function readLogFile(
    logPath: string,
    fromOffset = 0,
    maxBytes = 64 * 1024,
): Promise<{ content: string; offset: number; size: number }> {
    try {
        const stat = await fs.stat(logPath);
        const size = stat.size;
        let start = Math.max(0, fromOffset);
        if (start > size) start = 0;
        if (size - start > maxBytes) start = size - maxBytes;
        const fh = await fs.open(logPath, 'r');
        try {
            const length = size - start;
            const buf = Buffer.alloc(length);
            await fh.read(buf, 0, length, start);
            return { content: buf.toString('utf8'), offset: size, size };
        } finally {
            await fh.close();
        }
    } catch {
        return { content: '', offset: 0, size: 0 };
    }
}

export async function readSandboxLog(
    runId: string,
    fromOffset = 0,
    maxBytes = 64 * 1024,
): Promise<{ content: string; offset: number; size: number }> {
    return readLogFile(path.join(DEPLOYMENTS_ROOT, runId, 'sandbox.log'), fromOffset, maxBytes);
}

export async function getDeployment(runId: string): Promise<Deployment | null> {
    const r = await pool.query(
        `SELECT run_id, status, port, pid, url, work_dir, log_path, start_command, error,
                started_at, stopped_at, updated_at,
                verification_status, verification_result
           FROM pipeline_deployments WHERE run_id = $1`,
        [runId]
    );
    if (r.rowCount === 0) return null;
    return r.rows[0] as Deployment;
}

export async function stopDeployment(runId: string): Promise<{ stopped: boolean }> {
    const existing = await getDeployment(runId);
    if (!existing) return { stopped: false };

    // Stop the log-follower process.
    const follower = liveProcesses.get(runId);
    if (follower && !follower.killed) {
        try { follower.kill('SIGTERM'); } catch { /* ignore */ }
    }
    liveProcesses.delete(runId);

    // Stop and remove the Docker container (best-effort).
    const cname = containerName(runId);
    const stopLog = path.join(DEPLOYMENTS_ROOT, runId, LOG_FILE_NAME);
    try {
        await dockerCmd(['stop', cname], stopLog, 15_000);
    } catch { /* already stopped */ }
    try {
        await dockerCmd(['rm', cname], stopLog, 10_000);
    } catch { /* already removed */ }

    await pool.query(
        `UPDATE pipeline_deployments
           SET status = 'stopped', stopped_at = now(), pid = NULL
         WHERE run_id = $1`,
        [runId]
    );
    return { stopped: true };
}

/**
 * Build a Docker image from the run's source tree and start a container.
 * Returns immediately after inserting the DB row in `installing` state —
 * the build + run happen in the background and SSE pushes `running`/`failed`.
 */
export async function deployRun(runId: string): Promise<Deployment> {
    const workDir = path.join(DEPLOYMENTS_ROOT, runId, SOURCE_DIR_NAME);
    const logPath = path.join(DEPLOYMENTS_ROOT, runId, LOG_FILE_NAME);

    const sourceExists = await fs.access(workDir).then(() => true).catch(() => false);
    if (!sourceExists) {
        throw new Error(`source directory not found at ${workDir} — re-run the pipeline so the implementation tree is persisted`);
    }

    // If already running, return current state.
    const existing = await getDeployment(runId);
    if (existing && (existing.status === 'starting' || existing.status === 'installing' || existing.status === 'running')) {
        return existing;
    }

    // Kill the existing container BEFORE allocating a port so its host port is freed
    // and allocatePort()'s docker-ps check sees it as available.
    const cname = containerName(runId);
    const iname = imageName(runId);
    try { await dockerCmd(['rm', '-f', cname], logPath, 10_000); } catch { /* none existed */ }

    const port = await allocatePort();
    const url = `http://${PUBLIC_HOST}:${port}`;
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, `[deploy] starting Docker deployment for ${runId} at ${new Date().toISOString()}\n`, 'utf8');

    await pool.query(
        `INSERT INTO pipeline_deployments (run_id, status, port, url, work_dir, log_path, started_at, stopped_at, error, pid, start_command)
         VALUES ($1, 'installing', $2, $3, $4, $5, now(), NULL, NULL, NULL, NULL)
         ON CONFLICT (run_id) DO UPDATE
           SET status = 'installing', port = EXCLUDED.port, url = EXCLUDED.url, work_dir = EXCLUDED.work_dir,
               log_path = EXCLUDED.log_path, started_at = now(), stopped_at = NULL,
               error = NULL, pid = NULL, start_command = NULL`,
        [runId, port, url, workDir, logPath]
    );

    (async () => {
        try {
            // Use AI to decide deployment topology (single vs multi-container).
            await appendLog(logPath, `[deploy] analysing project structure with AI…\n`);
            const strategy = await aiDockerStrategy(workDir, logPath);
            await appendLog(logPath, `[deploy] strategy: ${strategy.containers.length} container(s): ${strategy.containers.map(c => c.name).join(', ')}\n`);

            // Write .dockerignore once at root
            await fs.writeFile(path.join(workDir, '.dockerignore'),
                'node_modules\n.next\ndist\ncoverage\n.git\n__pycache__\n*.pyc\n.venv\n',
            ).catch(() => { /* ignore */ });

            // Ensure every container has a Dockerfile, then build its image.
            const builtImages: Array<{ spec: ContainerSpec; image: string }> = [];
            for (const spec of strategy.containers) {
                await ensureDockerfile(workDir, spec);
                await appendLog(logPath, `[deploy] Dockerfile ready: ${spec.dockerfile}\n`);
                const img = `${iname}-${spec.name}`;
                await appendLog(logPath, `[deploy] building image ${img}…\n`);
                await dockerCmd(
                    ['build', '--tag', img,
                     '--file', path.join(workDir, spec.dockerfile),
                     path.join(workDir, spec.context)],
                    logPath,
                    15 * 60 * 1000,
                );
                builtImages.push({ spec, image: img });
            }

            // For multi-container, the FIRST container (frontend / main app) gets the
            // allocated public port. Additional containers get ephemeral Docker-assigned ports.
            const primarySpec = builtImages[0].spec;
            const primaryImage = builtImages[0].image;
            const primaryCname = cname; // main container keeps the predictable name

            await appendLog(logPath, `[deploy] starting primary container ${primaryCname} on host port ${port}…\n`);
            await dockerCmd(
                ['run', '-d',
                 '--name', primaryCname,
                 '-p', `${port}:${primarySpec.port}`,
                 '--restart', 'unless-stopped',
                 primaryImage],
                logPath, 30_000,
            );

            // Start additional containers (backend etc.) on auto-assigned ports, linked to primary network
            for (const { spec, image } of builtImages.slice(1)) {
                const svcCname = `${cname}-${spec.name}`;
                try { await dockerCmd(['rm', '-f', svcCname], logPath, 10_000); } catch { /* ok */ }
                await appendLog(logPath, `[deploy] starting sidecar ${svcCname}…\n`);
                await dockerCmd(
                    ['run', '-d',
                     '--name', svcCname,
                     '--restart', 'unless-stopped',
                     image],
                    logPath, 30_000,
                );
            }

            const startCmd = strategy.containers.map((s, i) =>
                `docker run -d --name ${i === 0 ? cname : `${cname}-${s.name}`} -p ${i === 0 ? `${port}:${s.port}` : s.port} ${iname}-${s.name}`
            ).join(' && ');

            await pool.query(
                `UPDATE pipeline_deployments SET status = 'running', start_command = $2, verification_status = 'pending' WHERE run_id = $1`,
                [runId, startCmd]
            );
            console.log(`[deploymentService] ${runId} running — primary on port ${port} (${strategy.containers.length} container(s))`);

            // Launch browser verification after a short delay so the app has time to
            // compile. Non-blocking — updates verification_status / verification_result in DB.
            setTimeout(() => {
                runVerificationAndStore(runId, port, logPath).catch(e =>
                    console.error(`[verify] background crash for ${runId}:`, e)
                );
            }, 15_000);

            // Tail the primary container logs into our log file.
            const follower = spawn('docker', ['logs', '--follow', primaryCname], { stdio: ['ignore', 'pipe', 'pipe'] });
            liveProcesses.set(runId, follower);
            const logStream = createWriteStream(logPath, { flags: 'a' });
            follower.stdout?.pipe(logStream, { end: false });
            follower.stderr?.pipe(logStream, { end: false });
            follower.on('close', (exitCode) => {
                liveProcesses.delete(runId);
                // If the container exited with a non-zero code, it crashed.
                if (exitCode !== 0 && exitCode !== null) {
                    schedulePostCrashFix(runId, logPath, primaryCname);
                } else {
                    pool.query(
                        `UPDATE pipeline_deployments SET status = 'stopped', stopped_at = now(), pid = NULL WHERE run_id = $1 AND status = 'running'`,
                        [runId]
                    ).catch(() => { /* ignore */ });
                }
            });

            // Also scan the log after an initial warm-up window for runtime crash patterns
            // (e.g. Next.js build fails after the container starts but before it serves)
            scheduleCrashScan(runId, logPath);

        } catch (e) {
            const msg = e instanceof Error ? e.message : 'deploy failed';
            console.error(`[deploymentService] deploy ${runId} failed:`, msg);
            await pool.query(
                `UPDATE pipeline_deployments SET status = 'failed', error = $2, stopped_at = now() WHERE run_id = $1`,
                [runId, msg]
            ).catch(() => { /* ignore */ });
        }
    })().catch((e) => console.error(`[deploymentService] async block crashed:`, e));

    return (await getDeployment(runId))!;
}

// ─── Source file browser ──────────────────────────────────────────────────────

const TREE_SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '__pycache__', '.venv', 'venv', '.vitest-cache']);
const MAX_FILE_SIZE = 256 * 1024; // 256 KB — don't serve binary blobs

export interface TreeNode {
    name: string;
    path: string;           // relative to source root
    type: 'file' | 'dir';
    size?: number;
    children?: TreeNode[];
}

async function buildTree(absDir: string, relBase: string): Promise<TreeNode[]> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    const nodes: TreeNode[] = [];
    for (const e of entries) {
        if (TREE_SKIP.has(e.name) || e.name.startsWith('.')) continue;
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
            nodes.push({ name: e.name, path: rel, type: 'dir', children: await buildTree(path.join(absDir, e.name), rel) });
        } else if (e.isFile()) {
            const stat = await fs.stat(path.join(absDir, e.name)).catch(() => null);
            nodes.push({ name: e.name, path: rel, type: 'file', size: stat?.size ?? 0 });
        }
    }
    return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

// Reconstruct a virtual file map from the implementation artifact_json stored
// in the database. Used as fallback when the on-disk source directory doesn't
// exist (e.g. runs that completed before the persist-source feature was deployed).
async function getSourceFilesFromDB(runId: string): Promise<Map<string, string>> {
    const result = await pool.query(
        `SELECT artifact_json FROM pipeline_stage_status
         WHERE run_id = $1 AND stage = 'implementation'
         LIMIT 1`,
        [runId]
    );
    if (result.rows.length === 0) throw new Error('no implementation artifact found');
    const artifact = result.rows[0].artifact_json;
    const files = new Map<string, string>();

    // Sprint mode: outcomes[].implementation_json.files_changed
    const outcomes: any[] = artifact?.sprint?.outcomes ?? [];
    for (const o of outcomes) {
        for (const f of o?.implementation_json?.files_changed ?? []) {
            if (f.path && f.action !== 'delete' && f.contents != null) {
                files.set(f.path, f.contents);
            }
        }
    }

    // Single-ticket mode: parsed.files_changed
    if (files.size === 0) {
        const parsed = artifact?.parsed ?? artifact;
        for (const f of parsed?.files_changed ?? []) {
            if (f.path && f.action !== 'delete' && f.contents != null) {
                files.set(f.path, f.contents);
            }
        }
    }

    if (files.size === 0) throw new Error('no source files found in artifact');
    return files;
}

function buildTreeFromMap(files: Map<string, string>): TreeNode[] {
    type DirMap = Map<string, { type: 'dir'; name: string; path: string; children: DirMap } | { type: 'file'; name: string; path: string; size: number }>;

    const rootChildren: DirMap = new Map();

    for (const [filePath, content] of files) {
        const parts = filePath.split('/').filter(Boolean);
        let cur = rootChildren;
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            const relPath = parts.slice(0, i + 1).join('/');
            const isLast = i === parts.length - 1;
            if (isLast) {
                cur.set(name, { type: 'file', name, path: relPath, size: Buffer.byteLength(content, 'utf8') });
            } else {
                if (!cur.has(name)) cur.set(name, { type: 'dir', name, path: relPath, children: new Map() });
                const dir = cur.get(name) as { type: 'dir'; children: DirMap };
                cur = dir.children;
            }
        }
    }

    function toArray(m: DirMap): TreeNode[] {
        return Array.from(m.values()).map(n =>
            n.type === 'dir'
                ? { name: n.name, path: n.path, type: 'dir' as const, children: toArray(n.children) }
                : { name: n.name, path: n.path, type: 'file' as const, size: n.size }
        ).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    return toArray(rootChildren);
}

export async function getSourceTree(runId: string): Promise<TreeNode[]> {
    const sourceDir = path.join(DEPLOYMENTS_ROOT, runId, SOURCE_DIR_NAME);
    const hasDisk = await fs.access(sourceDir).then(() => true).catch(() => false);
    if (hasDisk) return buildTree(sourceDir, '');

    // Fallback: reconstruct from DB artifact
    const files = await getSourceFilesFromDB(runId);
    return buildTreeFromMap(files);
}

export async function getSourceFile(runId: string, filePath: string): Promise<{ content: string; size: number; truncated: boolean }> {
    // Sanitize: strip leading slash, resolve, ensure it stays inside sourceDir
    const sourceDir = path.join(DEPLOYMENTS_ROOT, runId, SOURCE_DIR_NAME);
    const safe = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const abs = path.join(sourceDir, safe);
    if (!abs.startsWith(sourceDir + path.sep) && abs !== sourceDir) {
        throw new Error('path traversal rejected');
    }

    const hasDisk = await fs.access(sourceDir).then(() => true).catch(() => false);
    if (hasDisk) {
        const stat = await fs.stat(abs);
        const truncated = stat.size > MAX_FILE_SIZE;
        const fh = await fs.open(abs, 'r');
        try {
            const len = truncated ? MAX_FILE_SIZE : stat.size;
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, 0);
            return { content: buf.toString('utf8'), size: stat.size, truncated };
        } finally {
            await fh.close();
        }
    }

    // Fallback: read from DB artifact
    const files = await getSourceFilesFromDB(runId);
    if (!files.has(safe)) throw new Error(`file not found: ${safe}`);
    const content = files.get(safe)!;
    const size = Buffer.byteLength(content, 'utf8');
    const truncated = size > MAX_FILE_SIZE;
    return { content: truncated ? content.slice(0, MAX_FILE_SIZE) : content, size, truncated };
}
