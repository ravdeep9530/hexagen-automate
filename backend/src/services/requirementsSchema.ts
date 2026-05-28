// Canonical shape of the Step 1 requirements artifact. The Dify prompt
// for `sdlc-01-requirements-intake` produces this; the SharePoint sync
// endpoint validates incoming JSON against it. Keep in lockstep with the
// prompt in infra/dify/apps/prompts.json.

export const REQUIREMENTS_SCHEMA_VERSION = 1;

export interface RequirementsArtifact {
    title: string;
    user_stories: string[];
    functional_requirements: string[];
    non_functional_requirements?: string[];
    acceptance_criteria: string[];
    open_questions: string[];
    assumptions?: string[];
    out_of_scope?: string[];
    source?: 'dify' | 'sharepoint' | 'manual';
    version?: number;
}

export interface ClarificationRound {
    round: number;
    asked_at: string;
    answered_at: string;
    questions: string[];
    answers: Record<string, string>;
    dify_message_id: string | null;
    open_questions_after: string[];
}

export type ValidateResult =
    | { valid: true; value: RequirementsArtifact }
    | { valid: false; errors: string[] };

function isStringArray(x: unknown): x is string[] {
    return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

export function validateRequirements(input: unknown): ValidateResult {
    const errors: string[] = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { valid: false, errors: ['root must be an object'] };
    }
    const obj = input as Record<string, unknown>;

    if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
        errors.push('title must be a non-empty string');
    }
    for (const field of ['user_stories', 'functional_requirements', 'acceptance_criteria', 'open_questions'] as const) {
        if (!isStringArray(obj[field])) errors.push(`${field} must be string[]`);
    }
    for (const field of ['non_functional_requirements', 'assumptions', 'out_of_scope'] as const) {
        if (obj[field] !== undefined && !isStringArray(obj[field])) {
            errors.push(`${field} must be string[] when present`);
        }
    }
    if (obj.source !== undefined && !['dify', 'sharepoint', 'manual'].includes(obj.source as string)) {
        errors.push("source must be one of 'dify' | 'sharepoint' | 'manual' when present");
    }
    if (obj.version !== undefined && (typeof obj.version !== 'number' || !Number.isFinite(obj.version))) {
        errors.push('version must be a number when present');
    }

    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, value: obj as unknown as RequirementsArtifact };
}

// JSON-schema representation we can show in the UI on validation failure
// and (eventually) echo back in the Dify prompt so the model and the
// validator never drift.
export const REQUIREMENTS_JSON_SCHEMA = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['title', 'user_stories', 'functional_requirements', 'acceptance_criteria', 'open_questions'],
    properties: {
        title: { type: 'string', minLength: 1 },
        user_stories: { type: 'array', items: { type: 'string' } },
        functional_requirements: { type: 'array', items: { type: 'string' } },
        non_functional_requirements: { type: 'array', items: { type: 'string' } },
        acceptance_criteria: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        assumptions: { type: 'array', items: { type: 'string' } },
        out_of_scope: { type: 'array', items: { type: 'string' } },
        source: { type: 'string', enum: ['dify', 'sharepoint', 'manual'] },
        version: { type: 'number' },
    },
} as const;
