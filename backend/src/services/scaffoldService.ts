import { promises as fs } from 'fs';
import * as path from 'path';

import { githubService } from './githubService';
import type { FileChange } from './agentImplementationService';

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/app/templates';
const MANIFEST_PATH = path.join(TEMPLATES_DIR, 'manifest.json');

interface TemplateMeta {
    description: string;
    root: string;             // path under TEMPLATES_DIR (e.g. "templates/next-app-shadcn")
    scaffold_pr_title: string;
    scaffold_pr_body: string;
    branch_name: string;
}

interface Manifest {
    templates: Record<string, TemplateMeta>;
}

async function loadManifest(): Promise<Manifest> {
    try {
        const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
        return JSON.parse(raw) as Manifest;
    } catch (e) {
        throw new Error(`Failed to load template manifest at ${MANIFEST_PATH}: ${(e as Error).message}`);
    }
}

export async function listTemplates(): Promise<Array<{ id: string; description: string }>> {
    const m = await loadManifest();
    return Object.entries(m.templates).map(([id, t]) => ({ id, description: t.description }));
}

/**
 * Walk a template directory recursively and return every regular file as
 * { path-relative-to-template-root, contents }. Skips node_modules and .next
 * just in case someone accidentally builds inside the template.
 */
async function readTemplateFiles(absRoot: string): Promise<Array<{ path: string; contents: string }>> {
    const out: Array<{ path: string; contents: string }> = [];
    const SKIP = new Set(['node_modules', '.next', 'dist', '.git', '.vitest-cache', 'coverage']);

    async function walk(dir: string, relBase: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            if (SKIP.has(e.name)) continue;
            const abs = path.join(dir, e.name);
            const rel = relBase ? `${relBase}/${e.name}` : e.name;
            if (e.isDirectory()) {
                await walk(abs, rel);
            } else if (e.isFile()) {
                const contents = await fs.readFile(abs, 'utf8');
                out.push({ path: rel, contents });
            }
        }
    }
    await walk(absRoot, '');
    return out;
}

/**
 * Find the template at `templates_dir/<templateRootName>/` regardless of
 * whether the manifest "root" field is "templates/next-app-shadcn" (legacy,
 * project-relative) or just "next-app-shadcn" (template-id relative).
 */
function resolveTemplateRoot(rootField: string): string {
    // Strip a leading "templates/" if present so we get the bare template dir.
    const bare = rootField.replace(/^templates\//, '');
    return path.join(TEMPLATES_DIR, bare);
}

export interface ScaffoldResult {
    pr_url: string | null;
    pr_number: number | null;
    branch_name: string | null;
    files_count: number;
    template_id: string;
    error?: string;
}

/**
 * Open the scaffold PR for a brand-new project. Returns the branch name that
 * subsequent implementation PRs should use as their base.
 */
export async function openScaffoldPR(
    repo: string,
    templateId: string,
): Promise<ScaffoldResult> {
    const pat = process.env.GITHUB_PAT;
    if (!pat) {
        return { pr_url: null, pr_number: null, branch_name: null, files_count: 0, template_id: templateId, error: 'GITHUB_PAT not configured' };
    }

    const m = await loadManifest();
    const meta = m.templates[templateId];
    if (!meta) {
        return { pr_url: null, pr_number: null, branch_name: null, files_count: 0, template_id: templateId, error: `unknown template_id "${templateId}"` };
    }

    const absRoot = resolveTemplateRoot(meta.root);
    let files: Array<{ path: string; contents: string }>;
    try {
        files = await readTemplateFiles(absRoot);
    } catch (e) {
        return { pr_url: null, pr_number: null, branch_name: null, files_count: 0, template_id: templateId, error: `failed to read template files: ${(e as Error).message}` };
    }
    if (files.length === 0) {
        return { pr_url: null, pr_number: null, branch_name: null, files_count: 0, template_id: templateId, error: `template "${templateId}" has no files` };
    }

    const filesChanged: FileChange[] = files.map(f => ({
        path: f.path,
        action: 'create',
        contents: f.contents,
        reason: 'scaffold from curated template',
    }));

    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
        return { pr_url: null, pr_number: null, branch_name: null, files_count: 0, template_id: templateId, error: `repo "${repo}" must be owner/name` };
    }

    try {
        const pr = await githubService.createBranchAndPR(pat, owner, repoName, {
            branchName: meta.branch_name,
            commitMessage: meta.scaffold_pr_title,
            filesChanged,
            prTitle: meta.scaffold_pr_title,
            prBody: meta.scaffold_pr_body,
        });
        console.log(`[scaffold] Opened PR #${pr.prNumber} for ${repo} using template "${templateId}": ${pr.prUrl}`);
        return {
            pr_url: pr.prUrl,
            pr_number: pr.prNumber,
            branch_name: pr.branchName,
            files_count: filesChanged.length,
            template_id: templateId,
        };
    } catch (e) {
        return { pr_url: null, pr_number: null, branch_name: null, files_count: filesChanged.length, template_id: templateId, error: (e as Error).message };
    }
}
