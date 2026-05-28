// Azure AI Foundry Configuration
export const azureConfig = {
    openAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    openAIApiKey: process.env.AZURE_OPENAI_API_KEY || '',
    openAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
    openAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview',
    projectEndpoint: process.env.AZURE_AI_PROJECT_ENDPOINT || '',
    keyVaultName: process.env.AZURE_KEY_VAULT_NAME || '',
    searchEndpoint: process.env.AZURE_AI_SEARCH_ENDPOINT || '',
    searchIndex: process.env.AZURE_AI_SEARCH_INDEX || 'clinical-knowledge',
    region: process.env.AZURE_REGION || 'canadacentral',
};

// Coding-agent specific model — defaults to main azureConfig if not set
export const agentConfig = {
    endpoint:   process.env.AGENT_OPENAI_ENDPOINT   || process.env.AZURE_OPENAI_ENDPOINT   || '',
    apiKey:     process.env.AGENT_OPENAI_API_KEY     || process.env.AZURE_OPENAI_API_KEY     || '',
    deployment: process.env.AGENT_OPENAI_DEPLOYMENT  || process.env.AZURE_OPENAI_DEPLOYMENT  || 'gpt-4o',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview',
};

export function validateAzureConfig(): void {
    const missing = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT']
        .filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.warn(`Missing Azure configuration: ${missing.join(', ')} — running in mock mode.`);
    }
}

// Direct fetch to Azure AI Foundry endpoint using API key (no SDK auth chain required)
export async function callAzureChat(
    messages: Array<{ role: string; content: string }>,
    temperature = 0.3
): Promise<string> {
    const { openAIEndpoint, openAIApiKey, openAIDeployment, openAIApiVersion } = azureConfig;

    if (!openAIEndpoint || !openAIApiKey) {
        throw new Error('Azure OpenAI endpoint or API key not configured');
    }

    const isFoundry = openAIEndpoint.includes('.services.ai.azure.com') || openAIEndpoint.includes('/openai/v1/');
    const url = openAIEndpoint.includes('/chat/completions')
        ? isFoundry ? openAIEndpoint : `${openAIEndpoint}?api-version=${openAIApiVersion}`
        : `${openAIEndpoint}/openai/deployments/${openAIDeployment}/chat/completions?api-version=${openAIApiVersion}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': openAIApiKey,
        },
        body: JSON.stringify({
            model: openAIDeployment,
            messages,
            temperature,
            ...(isFoundry ? { max_tokens: 16000 } : { max_completion_tokens: 16000 }),
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure OpenAI error ${response.status}: ${body}`);
    }

    const data = await response.json() as Record<string, unknown>;

    type Choice = { message?: { content?: string; reasoning_content?: string }; text?: string };
    const choices = data.choices as Choice[] | undefined;
    if (!choices || choices.length === 0) {
        throw new Error(`Azure OpenAI returned no choices. Response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const msg = choices[0]?.message;
    // Reasoning models (e.g. Kimi-K2) put chain-of-thought in reasoning_content and the
    // final answer in content. If content is empty the model ran out of output tokens —
    // try extracting a JSON block from reasoning_content as a last resort.
    const content = msg?.content?.trim() || '';
    if (content) return content;

    const reasoning = msg?.reasoning_content?.trim() || '';
    if (reasoning) {
        const jsonMatch = reasoning.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                          reasoning.match(/(\{[\s\S]*"issues"[\s\S]*\})/);
        if (jsonMatch) return jsonMatch[1];
        console.warn('[Azure] content was empty; reasoning_content also had no JSON block. Returning empty.');
    }
    return '';
}

export function isAzureConfigured(): boolean {
    return !!(azureConfig.openAIEndpoint && azureConfig.openAIApiKey);
}

/**
 * Same as callAzureChat but uses agentConfig (Kimi K2.5 / primary coding model)
 * rather than the main azureConfig. Use this for code-heavy generation tasks
 * (page.tsx, Dockerfile generation) where the coding model outperforms gpt-5.5.
 */
export async function callAgentChat(
    messages: Array<{ role: string; content: string }>,
    temperature = 0.3,
): Promise<string> {
    const { endpoint, apiKey, deployment, apiVersion } = agentConfig;
    if (!endpoint || !apiKey) {
        throw new Error('Agent endpoint or API key not configured');
    }
    const isFoundry = endpoint.includes('.services.ai.azure.com') || endpoint.includes('/openai/v1/');
    const url = endpoint.includes('/chat/completions')
        ? isFoundry ? endpoint : `${endpoint}?api-version=${apiVersion}`
        : `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
            model: deployment,
            messages,
            temperature,
            ...(isFoundry ? { max_tokens: 16000 } : { max_completion_tokens: 16000 }),
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Agent chat error ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = await response.json() as Record<string, unknown>;
    type Choice = { message?: { content?: string; reasoning_content?: string } };
    const choices = data.choices as Choice[] | undefined;
    const content = choices?.[0]?.message?.content?.trim() || '';
    if (content) return content;
    const reasoning = (choices?.[0]?.message as any)?.reasoning_content?.trim() || '';
    if (reasoning) {
        const m = reasoning.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || reasoning.match(/(\{[\s\S]*"files"[\s\S]*\})/);
        if (m) return m[1];
    }
    return '';
}
