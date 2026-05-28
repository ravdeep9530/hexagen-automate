export interface GitHubConfig {
    token: string;
    owner?: string;
    repo?: string;
}

export interface PullRequest {
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    user: { login: string };
    created_at: string;
    updated_at: string;
    head: { ref: string; sha: string };
    base: { ref: string };
}

export interface Repository {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    default_branch: string;
    language: string | null;
}

class GitHubService {
    private apiUrl = 'https://api.github.com';

    private headers(config: GitHubConfig) {
        return {
            Authorization: `Bearer ${config.token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'SDL-Agentic-Platform',
        };
    }

    async testConnection(config: GitHubConfig): Promise<{ success: boolean; message: string }> {
        try {
            const response = await fetch(`${this.apiUrl}/user`, {
                headers: this.headers(config),
            });
            if (!response.ok) {
                return { success: false, message: `GitHub API error: ${response.status}` };
            }
            const user = await response.json();
            return {
                success: true,
                message: `Connected as ${user.login} (${user.name || 'No name'})`,
            };
        } catch (error) {
            return {
                success: false,
                message: `GitHub authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }

    async listRepositories(config: GitHubConfig): Promise<Repository[]> {
        const response = await fetch(`${this.apiUrl}/user/repos?per_page=100&sort=updated`, {
            headers: this.headers(config),
        });
        if (!response.ok) throw new Error(`Failed to list repos: ${response.status}`);
        const data = await response.json();
        return data.map((repo: Record<string, unknown>) => ({
            id: repo.id as number,
            name: repo.name as string,
            full_name: repo.full_name as string,
            description: repo.description as string | null,
            html_url: repo.html_url as string,
            default_branch: repo.default_branch as string,
            language: repo.language as string | null,
        }));
    }

    async listPullRequests(config: GitHubConfig, owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
        const response = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/pulls?state=${state}&per_page=50&sort=updated`, {
            headers: this.headers(config),
        });
        if (!response.ok) throw new Error(`Failed to list PRs: ${response.status}`);
        const data = await response.json();
        return data.map((pr: Record<string, unknown>) => ({
            number: pr.number as number,
            title: pr.title as string,
            body: pr.body as string | null,
            state: pr.state as string,
            html_url: pr.html_url as string,
            user: { login: (pr.user as Record<string, unknown>)?.login as string || 'unknown' },
            created_at: pr.created_at as string,
            updated_at: pr.updated_at as string,
            head: { ref: (pr.head as Record<string, unknown>).ref as string, sha: (pr.head as Record<string, unknown>).sha as string },
            base: { ref: (pr.base as Record<string, unknown>).ref as string },
        }));
    }

    async getPullRequestFiles(config: GitHubConfig, owner: string, repo: string, pullNumber: number): Promise<Array<{ filename: string; status: string; patch?: string; additions: number; deletions: number }>> {
        const response = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/pulls/${pullNumber}/files`, {
            headers: this.headers(config),
        });
        if (!response.ok) throw new Error(`Failed to get PR files: ${response.status}`);
        const data = await response.json();
        return data.map((file: Record<string, unknown>) => ({
            filename: file.filename as string,
            status: file.status as string,
            patch: file.patch as string | undefined,
            additions: file.additions as number,
            deletions: file.deletions as number,
        }));
    }

    async createPullRequestReview(config: GitHubConfig, owner: string, repo: string, pullNumber: number, comments: Array<{ path: string; line?: number; body: string }>, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' = 'COMMENT'): Promise<void> {
        // GitHub PR review comments require position within diff, not absolute line.
        // Post each comment as an issue comment on the PR thread instead to avoid 422.
        for (const comment of comments) {
            const body = `**${comment.path}** (line ${comment.line || '?'}):\n\n${comment.body}`;
            await this.createIssueComment(config, owner, repo, pullNumber, body);
        }
    }

    async createIssueComment(config: GitHubConfig, owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
        const response = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
            method: 'POST',
            headers: { ...this.headers(config), 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
        if (!response.ok) throw new Error(`Failed to create comment: ${response.status}`);
    }

    // Anchored review comment — appears inline on the diff in GitHub's "Files changed" tab.
    // For multi-line suggestions, set start_line and start_side as well.
    async createReviewComment(
        config: GitHubConfig,
        owner: string,
        repo: string,
        pullNumber: number,
        params: {
            commitId: string;
            path: string;
            line: number;
            startLine?: number;
            body: string;
            side?: 'RIGHT' | 'LEFT';
        }
    ): Promise<{ id: number; html_url: string } | null> {
        const payload: Record<string, unknown> = {
            commit_id: params.commitId,
            path: params.path,
            line: params.line,
            side: params.side || 'RIGHT',
            body: params.body,
        };
        if (params.startLine && params.startLine !== params.line) {
            payload.start_line = params.startLine;
            payload.start_side = params.side || 'RIGHT';
        }
        const response = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/pulls/${pullNumber}/comments`, {
            method: 'POST',
            headers: { ...this.headers(config), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (response.ok) {
            const data = await response.json();
            return { id: data.id, html_url: data.html_url };
        }
        // 422 means the line is outside the diff — caller should fall back to a general comment.
        return null;
    }

    /** Create a branch, commit all files from the implementation plan, open a draft PR. */
    async createBranchAndPR(
        token: string,
        owner: string,
        repo: string,
        opts: {
            branchName: string;
            commitMessage: string;
            filesChanged: Array<{ path: string; action: string; contents?: string }>;
            prTitle: string;
            prBody: string;
            /** Branch to base off + target the PR at. Defaults to repo default branch. */
            baseBranch?: string;
        }
    ): Promise<{ prUrl: string; prNumber: number; branchName: string }> {
        const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'SDL-Agentic-Platform', 'Content-Type': 'application/json' };

        // 1. Check if repo is empty; if so create initial commit on default branch
        const repoResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}`, { headers: h });
        if (!repoResp.ok) throw new Error(`Repo lookup failed: ${repoResp.status}`);
        const repoData = await repoResp.json();
        const defaultBranch: string = repoData.default_branch || 'main';
        const baseBranch: string = opts.baseBranch || defaultBranch;

        const refResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`, { headers: h });
        let baseSha: string;

        if (refResp.status === 404 || refResp.status === 409) {
            // Empty repo — seed with a README then get its SHA
            const seedResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/contents/README.md`, {
                method: 'PUT', headers: h,
                body: JSON.stringify({
                    message: 'chore: initial commit',
                    content: Buffer.from(`# ${repo}\n\nGenerated by SDLC Agentic Pipeline.\n`).toString('base64'),
                }),
            });
            if (!seedResp.ok) throw new Error(`Failed to seed empty repo: ${seedResp.status} ${await seedResp.text()}`);
            const seedData = await seedResp.json();
            baseSha = seedData.commit.sha;
        } else if (!refResp.ok) {
            throw new Error(`Failed to get branch ref: ${refResp.status}`);
        } else {
            const refData = await refResp.json();
            baseSha = refData.object.sha;
        }

        // 2. Create feature branch
        const branchResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/git/refs`, {
            method: 'POST', headers: h,
            body: JSON.stringify({ ref: `refs/heads/${opts.branchName}`, sha: baseSha }),
        });
        if (!branchResp.ok && branchResp.status !== 422) { // 422 = branch already exists
            throw new Error(`Branch creation failed: ${branchResp.status} ${await branchResp.text()}`);
        }

        // 3. Commit each file
        for (const file of opts.filesChanged || []) {
            if (!file.path || file.action === 'delete') continue;
            const content = Buffer.from(file.contents || '').toString('base64');
            // Check if file exists to get its SHA (needed for updates)
            const existingResp = await fetch(
                `${this.apiUrl}/repos/${owner}/${repo}/contents/${file.path}?ref=${opts.branchName}`,
                { headers: h }
            );
            const payload: Record<string, unknown> = {
                message: `${opts.commitMessage}: ${file.action} ${file.path}`,
                content,
                branch: opts.branchName,
            };
            if (existingResp.ok) {
                const existing = await existingResp.json();
                payload.sha = existing.sha;
            }
            const putResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/contents/${file.path}`, {
                method: 'PUT', headers: h, body: JSON.stringify(payload),
            });
            if (!putResp.ok) {
                console.error(`[github] Failed to write ${file.path}: ${putResp.status} ${await putResp.text()}`);
            }
        }

        // 4. Open draft PR (against the requested base, not necessarily default).
        // If a PR already exists for this branch (rerun case), reuse it — the
        // file commits above already force-updated the branch contents in place,
        // so the existing PR will show the latest code.
        const prResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/pulls`, {
            method: 'POST', headers: h,
            body: JSON.stringify({
                title: opts.prTitle,
                body: opts.prBody,
                head: opts.branchName,
                base: baseBranch,
                draft: true,
            }),
        });
        if (prResp.ok) {
            const pr = await prResp.json();
            return { prUrl: pr.html_url, prNumber: pr.number, branchName: opts.branchName };
        }
        const errText = await prResp.text();
        if (prResp.status === 422 && /already exists/i.test(errText)) {
            // Look up the existing PR for this branch and return it.
            const listResp = await fetch(
                `${this.apiUrl}/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${opts.branchName}`,
                { headers: h }
            );
            if (listResp.ok) {
                const list = (await listResp.json()) as Array<{ html_url: string; number: number }>;
                if (list.length > 0) {
                    console.log(`[github] PR already exists for ${opts.branchName}: #${list[0].number} — reusing on rerun`);
                    return { prUrl: list[0].html_url, prNumber: list[0].number, branchName: opts.branchName };
                }
            }
        }
        throw new Error(`PR creation failed: ${prResp.status} ${errText}`);
    }

    /**
     * Fetch the full file tree at a given ref as { path -> contents } so the
     * sandbox can run with the parent ticket's files already laid down.
     * Skips binary files and anything over 1MB.
     */
    async fetchTreeAsRecord(
        token: string,
        owner: string,
        repo: string,
        ref: string,
    ): Promise<Record<string, string>> {
        const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'SDL-Agentic-Platform' };
        const tree: Record<string, string> = {};

        // Resolve ref → sha
        const refResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/git/refs/heads/${ref}`, { headers: h });
        if (!refResp.ok) {
            // Branch doesn't exist (e.g. brand-new repo); return empty tree
            if (refResp.status === 404 || refResp.status === 409) return tree;
            throw new Error(`fetchTree: ref lookup failed ${refResp.status}`);
        }
        const refData = await refResp.json();
        const commitSha = refData.object.sha;

        // Walk the tree recursively in one call
        const treeResp = await fetch(
            `${this.apiUrl}/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
            { headers: h },
        );
        if (!treeResp.ok) throw new Error(`fetchTree: tree fetch failed ${treeResp.status}`);
        const treeData = await treeResp.json() as { tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated?: boolean };

        // Skip dirs, large files, and unfetchable items
        const fileEntries = treeData.tree.filter(e => e.type === 'blob' && (e.size ?? 0) < 1024 * 1024);

        // Fetch blob contents in parallel batches to keep total round-trips down
        const BATCH = 8;
        for (let i = 0; i < fileEntries.length; i += BATCH) {
            const batch = fileEntries.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(async (e) => {
                const blobResp = await fetch(`${this.apiUrl}/repos/${owner}/${repo}/git/blobs/${e.sha}`, { headers: h });
                if (!blobResp.ok) return null;
                const blob = await blobResp.json() as { content: string; encoding: string };
                if (blob.encoding !== 'base64') return null;
                try {
                    return { path: e.path, contents: Buffer.from(blob.content, 'base64').toString('utf8') };
                } catch {
                    return null;
                }
            }));
            for (const r of results) if (r) tree[r.path] = r.contents;
        }
        return tree;
    }

    async getFileContent(config: GitHubConfig, owner: string, repo: string, path: string, ref?: string): Promise<string> {
        const url = ref
            ? `${this.apiUrl}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
            : `${this.apiUrl}/repos/${owner}/${repo}/contents/${path}`;
        const response = await fetch(url, {
            headers: this.headers(config),
        });
        if (!response.ok) throw new Error(`Failed to get file content: ${response.status}`);
        const data = await response.json();
        if (data.content && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf-8');
        }
        throw new Error('File content not available');
    }
}

export const githubService = new GitHubService();
