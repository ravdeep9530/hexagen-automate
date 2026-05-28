import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
const PLAYWRIGHT_IMAGE = process.env.PLAYWRIGHT_IMAGE || 'mcr.microsoft.com/playwright:v1.48.2-jammy';
const VERIFY_TIMEOUT_MS = parseInt(process.env.VERIFY_TIMEOUT_MS || '150000', 10); // 2.5 min

export interface VerificationError {
    code: string;
    message: string;
}

export interface VerificationResult {
    passed: boolean;
    status: number | null;
    load_time_ms: number | null;
    errors: VerificationError[];
    warnings: VerificationError[];
    screenshot_path: string | null;
    ran_at: string;
    duration_ms: number;
}

// Node/CommonJS script that Playwright runs inside its Docker container.
// Written to disk and passed to `node` — no shell quoting issues.
// NODE_PATH is set by the caller to point to the cached playwright npm deps.
const PLAYWRIGHT_TEST_SCRIPT = `
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
    const url = process.env.TEST_URL;
    const screenshotPath = process.env.SCREENSHOT_PATH;
    const outputPath = process.env.OUTPUT_PATH;
    const maxWaitMs = parseInt(process.env.MAX_WAIT_MS || '90000', 10);

    const result = {
        url,
        passed: false,
        status: null,
        load_time_ms: null,
        errors: [],
        warnings: [],
    };

    const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        // Retry page.goto until the app responds or we hit the deadline
        let loaded = false;
        let lastError = null;
        const deadline = Date.now() + maxWaitMs;

        while (Date.now() < deadline && !loaded) {
            try {
                const t0 = Date.now();
                const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                result.status = response ? response.status() : null;
                result.load_time_ms = Date.now() - t0;
                loaded = true;
            } catch (e) {
                lastError = e.message;
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        if (!loaded) {
            result.errors.push({ code: 'app_not_ready', message: lastError || 'App did not respond in time' });
        } else {
            if (result.status !== 200) {
                result.errors.push({ code: 'http_error', message: 'HTTP ' + result.status });
            }

            // Small wait for React hydration / SSR
            await page.waitForTimeout(2500);

            const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
            const bodyHtml = await page.evaluate(() => document.body ? document.body.innerHTML : '').catch(() => '');

            // Next.js build-time compilation errors (shows even in dev mode)
            if (bodyHtml.includes('Failed to compile') || bodyText.includes('Build Error')) {
                const match = bodyText.match(/Module not found[^\\n]*/)?.[0]
                    || bodyText.match(/Cannot find module[^\\n]*/)?.[0]
                    || bodyText.match(/error TS\\d+[^\\n]*/)?.[0]
                    || 'Build compilation error';
                result.errors.push({ code: 'build_error', message: match });
            }

            // React runtime error overlay
            if (bodyText.includes('Application error') && bodyHtml.includes('client-side exception')) {
                result.errors.push({ code: 'runtime_error', message: 'React application error (client-side exception)' });
            }

            // 404 Not Found
            if (result.status === 404) {
                result.errors.push({ code: 'not_found', message: '404 Not Found at root URL' });
            }

            // Blank or near-empty page (< 30 chars of visible text)
            if (bodyText.trim().length < 30 && result.status === 200) {
                result.warnings.push({ code: 'blank_page', message: 'Page appears blank or near-empty' });
            }

            // Browser console errors
            if (consoleErrors.length > 0) {
                result.warnings.push({
                    code: 'console_errors',
                    message: consoleErrors.length + ' browser console error(s): ' + consoleErrors.slice(0, 3).join('; '),
                });
            }

            // Screenshot
            if (screenshotPath) {
                try {
                    await page.screenshot({ path: screenshotPath, clip: { x: 0, y: 0, width: 1280, height: 800 } });
                } catch (_) { /* non-fatal */ }
            }
        }

        result.passed = result.errors.length === 0;
        await context.close();
    } finally {
        await browser.close();
    }

    const output = JSON.stringify(result);
    if (outputPath) {
        try { fs.writeFileSync(outputPath, output); } catch (_) { /* ignore */ }
    }
    process.stdout.write(output + '\\n');
    process.exit(result.passed ? 0 : 1);
})().catch(e => {
    const out = JSON.stringify({ passed: false, errors: [{ code: 'script_error', message: e.message }], warnings: [] });
    process.stdout.write(out + '\\n');
    process.exit(1);
});
`;

async function appendLog(logPath: string, line: string): Promise<void> {
    try { await fs.appendFile(logPath, line, 'utf8'); } catch { /* swallow */ }
}

// Playwright npm package is NOT included in the browser-only Playwright Docker image.
// We install @playwright/test once into a persistent cache dir in the deployments
// volume (survives container restarts). Subsequent runs reuse the cached install.
const PW_DEPS_DIR = `${DEPLOYMENTS_ROOT}/.playwright-deps`;
const PW_VERSION = PLAYWRIGHT_IMAGE.match(/v(\d+\.\d+\.\d+)/)?.[1] || '1.48.2';

async function runDockerPlaywright(
    scriptPath: string,
    screenshotPath: string,
    outputPath: string,
    port: number,
    logPath: string,
): Promise<VerificationResult | null> {
    // Get this container's short ID so --volumes-from shares the deployments volume.
    let selfId = '';
    try { selfId = readFileSync('/etc/hostname', 'utf8').trim(); } catch { /* not in Docker */ }

    const testUrl = `http://localhost:${port}`;
    const started = Date.now();

    await appendLog(logPath, `[verify] starting Playwright browser test → ${testUrl}\n`);

    // The bash command:
    // 1. Installs @playwright/test if not yet cached (first run only, ~20s).
    // 2. Sets NODE_PATH so `require('@playwright/test')` resolves from the cache dir.
    // 3. Sets PLAYWRIGHT_BROWSERS_PATH so the package uses browsers already in the image.
    const installAndRun = [
        `[ -d ${PW_DEPS_DIR}/node_modules/@playwright/test ] || `,
        `npm install @playwright/test@${PW_VERSION} --prefix ${PW_DEPS_DIR} --no-fund --no-audit --quiet 2>&1 | tail -2; `,
        `NODE_PATH=${PW_DEPS_DIR}/node_modules `,
        `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright `,
        `node ${scriptPath}`,
    ].join('');

    return new Promise((resolve) => {
        const args = [
            'run', '--rm',
            '--network', 'host',       // reach localhost:PORT without routing through Docker NAT
            ...(selfId ? ['--volumes-from', selfId] : []),
            '--env', `TEST_URL=${testUrl}`,
            '--env', `SCREENSHOT_PATH=${screenshotPath}`,
            '--env', `OUTPUT_PATH=${outputPath}`,
            '--env', 'MAX_WAIT_MS=90000',
            PLAYWRIGHT_IMAGE,
            'bash', '-c', installAndRun,
        ];

        const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';

        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => {
            // Forward Playwright / Docker pull output to deployment log
            appendLog(logPath, d.toString()).catch(() => {});
        });

        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* ok */ }
            resolve(null); // caller converts null → timeout error
        }, VERIFY_TIMEOUT_MS);

        proc.on('close', (code) => {
            clearTimeout(timer);
            const durationMs = Date.now() - started;
            // Last JSON line of stdout is the result
            const lines = stdout.trim().split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const parsed = JSON.parse(lines[i]) as Omit<VerificationResult, 'ran_at' | 'duration_ms' | 'screenshot_path'>;
                    resolve({ ...parsed, screenshot_path: screenshotPath, ran_at: new Date().toISOString(), duration_ms: durationMs });
                    return;
                } catch { /* not JSON */ }
            }
            // Couldn't parse — synthesise a failure result
            resolve({
                passed: false, status: null, load_time_ms: null,
                errors: [{ code: 'docker_failed', message: `Playwright container exited ${code}` }],
                warnings: [],
                screenshot_path: null,
                ran_at: new Date().toISOString(),
                duration_ms: durationMs,
            });
        });

        proc.on('error', (e) => {
            clearTimeout(timer);
            resolve({
                passed: false, status: null, load_time_ms: null,
                errors: [{ code: 'docker_error', message: e.message }],
                warnings: [],
                screenshot_path: null,
                ran_at: new Date().toISOString(),
                duration_ms: Date.now() - started,
            });
        });
    });
}

/**
 * Run a headless Chromium (Playwright) browser test against the deployed app.
 * Writes a test script + screenshot to the run's deployments directory.
 * Returns a structured VerificationResult regardless of pass/fail.
 */
export async function verifyDeployedApp(
    runId: string,
    port: number,
    logPath: string,
): Promise<VerificationResult> {
    const runDir = path.join(DEPLOYMENTS_ROOT, runId);
    await fs.mkdir(runDir, { recursive: true });

    const scriptPath = path.join(runDir, 'playwright-test.js');
    const screenshotPath = path.join(runDir, 'screenshot.png');
    const outputPath = path.join(runDir, 'verify-result.json');

    await fs.writeFile(scriptPath, PLAYWRIGHT_TEST_SCRIPT, 'utf8');

    const result = await runDockerPlaywright(scriptPath, screenshotPath, outputPath, port, logPath);

    if (result) {
        const verdict = result.passed ? 'PASSED' : 'FAILED';
        await appendLog(logPath, `[verify] ${verdict} in ${result.duration_ms}ms\n`);
        for (const e of result.errors)   await appendLog(logPath, `[verify] ERROR [${e.code}]: ${e.message}\n`);
        for (const w of result.warnings) await appendLog(logPath, `[verify] WARN  [${w.code}]: ${w.message}\n`);
        return result;
    }

    // Docker timed out
    await appendLog(logPath, `[verify] TIMED OUT after ${VERIFY_TIMEOUT_MS / 1000}s\n`);
    return {
        passed: false, status: null, load_time_ms: null,
        errors: [{ code: 'timeout', message: `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s` }],
        warnings: [],
        screenshot_path: null,
        ran_at: new Date().toISOString(),
        duration_ms: VERIFY_TIMEOUT_MS,
    };
}
