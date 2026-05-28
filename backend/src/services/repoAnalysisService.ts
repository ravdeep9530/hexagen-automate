import { Pool } from 'pg';
import dotenv from 'dotenv';
import { githubService } from './githubService';
import { callAzureChat } from '../config/azure';

dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});

export interface RepoAnalysis {
    status: 'complete' | 'failed';
    purpose: string;
    tech_stack: string[];
    architecture: string;
    design: string;
    key_files: Array<{ path: string; description: string }>;
    summary: string;
    error?: string;
}

export function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
    const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    return null;
}

const KEY_FILES = [
    'README.md', 'README.rst', 'README.txt', 'readme.md',
    'package.json', 'requirements.txt', 'Cargo.toml', 'pyproject.toml',
    'go.mod', 'pom.xml', 'build.gradle', 'Gemfile',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    '.env.example', 'Makefile',
];

function buildFileContext(tree: Record<string, string>): string {
    const paths = Object.keys(tree);
    const treeSample = paths.slice(0, 120).join('\n');

    let keyContent = '';
    let totalChars = 0;
    const MAX_CHARS = 6000;

    for (const kf of KEY_FILES) {
        const content = tree[kf];
        if (!content) continue;
        const snippet = content.slice(0, 1500);
        if (totalChars + snippet.length > MAX_CHARS) break;
        keyContent += `\n\n--- ${kf} ---\n${snippet}`;
        totalChars += snippet.length;
    }

    return `File tree (first 120 paths):\n${treeSample}${keyContent}`;
}

async function setAnalysisStatus(projectUuid: string, status: string): Promise<void> {
    await pool.query(
        `UPDATE projects SET config = jsonb_set(COALESCE(config,'{}'), '{analysis_status}', $1::jsonb), updated_at = now() WHERE uuid = $2`,
        [JSON.stringify(status), projectUuid]
    );
}

async function writeAnalysisResult(projectUuid: string, analysis: RepoAnalysis): Promise<void> {
    const patch = { analysis, analysis_status: analysis.status };
    await pool.query(
        `UPDATE projects SET config = COALESCE(config,'{}') || $1::jsonb, updated_at = now() WHERE uuid = $2`,
        [JSON.stringify(patch), projectUuid]
    );
}

export const repoAnalysisService = {
    async analyzeRepo(projectUuid: string, token: string, owner: string, repo: string): Promise<void> {
        await setAnalysisStatus(projectUuid, 'pending');

        let tree: Record<string, string> = {};
        try {
            tree = await githubService.fetchTreeAsRecord(token, owner, repo, 'main');
            if (Object.keys(tree).length === 0) {
                tree = await githubService.fetchTreeAsRecord(token, owner, repo, 'master');
            }
        } catch (err) {
            console.error('[repoAnalysis] fetchTree error', err);
        }

        const fileContext = buildFileContext(tree);
        const totalFiles = Object.keys(tree).length;

        const systemPrompt = `You are a senior software architect analyzing a GitHub repository.
Analyze the repository and return ONLY a JSON object with exactly these keys (no markdown, no explanation):
{
  "purpose": "1-3 sentence description of what this project does",
  "tech_stack": ["array", "of", "technology", "names"],
  "architecture": "description of the high-level architecture and folder structure",
  "design": "key design patterns and decisions observed in the codebase",
  "key_files": [{"path": "relative/path", "description": "what this file does"}],
  "summary": "2-4 sentence executive summary of the project"
}
Return 5-10 key_files maximum. Be concise and technical.`;

        const userPrompt = `Repository: ${owner}/${repo}
Total files: ${totalFiles}

${fileContext}`;

        let analysis: RepoAnalysis;
        try {
            const raw = await callAzureChat(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                0.2
            );

            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object found in AI response');
            const parsed = JSON.parse(jsonMatch[0]);

            analysis = {
                status: 'complete',
                purpose: parsed.purpose ?? '',
                tech_stack: Array.isArray(parsed.tech_stack) ? parsed.tech_stack : [],
                architecture: parsed.architecture ?? '',
                design: parsed.design ?? '',
                key_files: Array.isArray(parsed.key_files) ? parsed.key_files : [],
                summary: parsed.summary ?? '',
            };
        } catch (err: any) {
            console.error('[repoAnalysis] AI analysis error', err);
            analysis = {
                status: 'failed',
                purpose: '',
                tech_stack: [],
                architecture: '',
                design: '',
                key_files: [],
                summary: '',
                error: err?.message ?? 'Unknown error during analysis',
            };
        }

        await writeAnalysisResult(projectUuid, analysis);
    },
};
