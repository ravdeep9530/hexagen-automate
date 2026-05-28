import { callAzureChat, isAzureConfigured } from '../config/azure';

// Job Types
export type AgentType =
    | 'requirements'
    | 'sprint'
    | 'test-automation'
    | 'mock-generation'
    | 'code-review'
    | 'documentation';

export interface AgentJob {
    id: string;
    agentType: AgentType;
    status: 'pending' | 'running' | 'completed' | 'failed';
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    logs: string[];
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
}

// Requirements Agent
export interface OptimizeRequirementsRequest {
    rawRequirements: string;
    projectContext?: string;
    existingFeatures?: string[];
}

export interface OptimizeRequirementsResponse {
    userStories: Array<{
        id: string;
        title: string;
        description: string;
        acceptanceCriteria: string[];
        priority: 'high' | 'medium' | 'low';
        storyPoints?: number;
    }>;
    gaps: string[];
    ambiguities: string[];
    suggestions: string[];
}

// Sprint Agent
export interface SprintPlanRequest {
    epicDescription: string;
    teamCapacity: number;
    sprintDuration: number;
    teamVelocity?: number;
    existingTasks?: string[];
}

export interface SprintPlanResponse {
    tasks: Array<{
        id: string;
        title: string;
        description: string;
        estimatedHours: number;
        dependencies: string[];
        assignee?: string;
        risk: 'low' | 'medium' | 'high';
    }>;
    criticalPath: string[];
    riskAssessment: string[];
    recommendedSprintScope: string;
}

// Test Automation Agent
export interface GenerateTestsRequest {
    codeSnippet?: string;
    apiSpec?: string;
    userStory?: string;
    testFramework: 'jest' | 'pytest' | 'mocha' | 'nunit';
    coverageTarget?: number;
}

export interface GenerateTestsResponse {
    testCases: Array<{
        name: string;
        code: string;
        type: 'unit' | 'integration' | 'e2e';
        description: string;
    }>;
    mockData?: Record<string, unknown>;
    coverageEstimate: number;
    edgeCases: string[];
}

// Mock Generation Agent
export interface GenerateMocksRequest {
    description: string;
    designSystem?: string;
    existingComponents?: string[];
    platform: 'web' | 'mobile' | 'desktop';
    framework: 'react' | 'vue' | 'angular';
}

export interface GenerateMocksResponse {
    html: string;
    css: string;
    components: Array<{
        name: string;
        code: string;
        props: Array<{ name: string; type: string; required: boolean }>;
    }>;
    storybookStories?: string[];
}

// Code Review Agent
export interface CodeReviewRequest {
    code: string;
    language: string;
    filePath?: string;
    standards?: string[];
}

export interface CodeReviewResponse {
    issues: Array<{
        severity: 'critical' | 'warning' | 'info';
        line?: number;
        start_line?: number;
        message: string;
        suggestion: string;
        replacement_code?: string;
        category: 'security' | 'performance' | 'style' | 'maintainability';
    }>;
    score: number;
    summary: string;
}

// Documentation Agent
export interface GenerateDocsRequest {
    code?: string;
    apiSpec?: string;
    type: 'api' | 'adr' | 'guide' | 'runbook';
    audience: 'developer' | 'user' | 'ops';
}

export interface GenerateDocsResponse {
    content: string;
    format: 'markdown' | 'html' | 'openapi';
    sections: string[];
}

class SDLAgentService {
    private mockMode = !isAzureConfigured();

    private async callAzureOpenAI(systemPrompt: string, userPrompt: string, temperature: number = 0.3): Promise<string> {
        return callAzureChat(
            [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            temperature
        );
    }

    async optimizeRequirements(request: OptimizeRequirementsRequest): Promise<OptimizeRequirementsResponse> {
        if (this.mockMode) {
            return {
                userStories: [
                    {
                        id: 'US-1',
                        title: 'User Login',
                        description: 'As a user, I want to login with my credentials so that I can securely access my account.',
                        acceptanceCriteria: [
                            'Given valid username and password, when I submit the login form, then I am authenticated and redirected to the dashboard',
                            'Given invalid credentials, when I submit the login form, then I see an error message',
                            'Given 3 failed attempts, when I try to login, then my account is temporarily locked'
                        ],
                        priority: 'high',
                        storyPoints: 5
                    },
                    {
                        id: 'US-2',
                        title: 'Password Reset',
                        description: 'As a user, I want to reset my password so that I can regain access if I forget it.',
                        acceptanceCriteria: [
                            'Given I click "Forgot Password", when I enter my email, then a reset link is sent',
                            'Given a valid reset token, when I submit a new password, then my password is updated'
                        ],
                        priority: 'medium',
                        storyPoints: 3
                    }
                ],
                gaps: [
                    'No mention of multi-factor authentication (MFA) requirements',
                    'Missing session timeout and management specifications',
                    'No definition of password complexity requirements',
                    'Unclear error handling for network failures during login'
                ],
                ambiguities: [
                    '"Fast and secure" is subjective - need specific performance metrics (e.g., <2s response time)',
                    'What authentication methods are supported (SSO, OAuth, LDAP)?',
                    'What is the target user volume for concurrent logins?'
                ],
                suggestions: [
                    'Add explicit MFA requirement for healthcare compliance',
                    'Define specific performance SLAs (e.g., 99th percentile < 2s)',
                    'Include account lockout policy with automatic unlock mechanism',
                    'Specify audit logging requirements for security compliance'
                ]
            };
        }

        const systemPrompt = `You are a requirements optimization specialist. Analyze raw requirements and produce structured user stories with acceptance criteria. Identify gaps, ambiguities, and suggest improvements.`;

        const userPrompt = `Optimize the following requirements:

${request.rawRequirements}

${request.projectContext ? `Project Context: ${request.projectContext}` : ''}
${request.existingFeatures ? `Existing Features: ${request.existingFeatures.join(', ')}` : ''}

Please provide:
1. Structured user stories with acceptance criteria (Gherkin format)
2. Identified gaps in requirements
3. Ambiguities that need clarification
4. Improvement suggestions`;

        const content = await this.callAzureOpenAI(systemPrompt, userPrompt, 0.3);

        return {
            userStories: this.parseUserStories(content),
            gaps: this.extractSection(content, 'Gaps'),
            ambiguities: this.extractSection(content, 'Ambiguities'),
            suggestions: this.extractSection(content, 'Suggestions'),
        };
    }

    async planSprint(request: SprintPlanRequest): Promise<SprintPlanResponse> {
        if (this.mockMode) {
            return {
                tasks: [
                    {
                        id: 'TASK-1',
                        title: 'Setup authentication API endpoints',
                        description: 'Create REST endpoints for login, logout, and token refresh',
                        estimatedHours: 8,
                        dependencies: [],
                        assignee: 'Backend Dev',
                        risk: 'medium'
                    },
                    {
                        id: 'TASK-2',
                        title: 'Implement JWT token management',
                        description: 'Setup JWT generation, validation, and refresh token rotation',
                        estimatedHours: 6,
                        dependencies: ['TASK-1'],
                        assignee: 'Backend Dev',
                        risk: 'low'
                    },
                    {
                        id: 'TASK-3',
                        title: 'Build login UI component',
                        description: 'Create responsive login form with validation and error handling',
                        estimatedHours: 6,
                        dependencies: [],
                        assignee: 'Frontend Dev',
                        risk: 'low'
                    },
                    {
                        id: 'TASK-4',
                        title: 'Integrate frontend with auth API',
                        description: 'Connect login UI to backend endpoints, handle tokens in storage',
                        estimatedHours: 4,
                        dependencies: ['TASK-1', 'TASK-3'],
                        assignee: 'Frontend Dev',
                        risk: 'medium'
                    },
                    {
                        id: 'TASK-5',
                        title: 'Write authentication unit tests',
                        description: 'Cover login flow, token validation, and edge cases',
                        estimatedHours: 4,
                        dependencies: ['TASK-2', 'TASK-4'],
                        assignee: 'QA Engineer',
                        risk: 'low'
                    }
                ],
                criticalPath: ['TASK-1', 'TASK-2', 'TASK-4', 'TASK-5'],
                riskAssessment: [
                    'TASK-1: Medium risk - OAuth integration complexity may exceed estimate',
                    'TASK-4: Medium risk - CORS or token storage issues could block integration',
                    'Overall: Team has not worked with JWT before, may need knowledge transfer'
                ],
                recommendedSprintScope: 'Focus on core login flow (TASK-1 through TASK-4). Defer password reset and MFA to next sprint to ensure quality delivery of authentication foundation.'
            };
        }

        const systemPrompt = `You are an agile project management expert. Decompose epics into sprint-sized tasks, identify dependencies, assess risks, and recommend optimal sprint scope.`;

        const userPrompt = `Plan a sprint for the following epic:

${request.epicDescription}

Team Capacity: ${request.teamCapacity} hours
Sprint Duration: ${request.sprintDuration} weeks
${request.teamVelocity ? `Team Velocity: ${request.teamVelocity} story points` : ''}
${request.existingTasks ? `Existing Tasks: ${request.existingTasks.join(', ')}` : ''}

Please provide:
1. Task breakdown with estimates and dependencies
2. Critical path identification
3. Risk assessment
4. Recommended sprint scope`;

        const content = await this.callAzureOpenAI(systemPrompt, userPrompt, 0.2);

        return {
            tasks: this.parseTasks(content),
            criticalPath: this.extractSection(content, 'Critical Path'),
            riskAssessment: this.extractSection(content, 'Risks'),
            recommendedSprintScope: this.extractFirstParagraph(content, 'Recommended Scope'),
        };
    }

    async generateTests(request: GenerateTestsRequest): Promise<GenerateTestsResponse> {
        if (this.mockMode) {
            return {
                testCases: [
                    {
                        name: 'should authenticate user with valid credentials',
                        code: `test('should authenticate user with valid credentials', async () => {\n  const result = await authService.login('user@example.com', 'password123');\n  expect(result.token).toBeDefined();\n  expect(result.user.email).toBe('user@example.com');\n});`,
                        type: 'unit',
                        description: 'Verify successful login returns valid JWT token'
                    },
                    {
                        name: 'should reject invalid password',
                        code: `test('should reject invalid password', async () => {\n  await expect(authService.login('user@example.com', 'wrong'))\n    .rejects.toThrow('Invalid credentials');\n});`,
                        type: 'unit',
                        description: 'Verify login fails with incorrect password'
                    },
                    {
                        name: 'should lock account after 3 failed attempts',
                        code: `test('should lock account after 3 failed attempts', async () => {\n  for (let i = 0; i < 3; i++) {\n    await expect(authService.login('user@example.com', 'wrong')).rejects.toThrow();\n  }\n  await expect(authService.login('user@example.com', 'password123'))\n    .rejects.toThrow('Account locked');\n});`,
                        type: 'integration',
                        description: 'Verify account lockout mechanism after repeated failures'
                    }
                ],
                mockData: {
                    validUser: { email: 'user@example.com', password: 'password123', role: 'patient' },
                    invalidUser: { email: 'user@example.com', password: 'wrong' },
                    lockedUser: { email: 'locked@example.com', password: 'password123', lockedUntil: '2024-01-01T00:00:00Z' }
                },
                coverageEstimate: 85,
                edgeCases: [
                    'Empty password field submission',
                    'SQL injection attempt in email field',
                    'Concurrent login requests from same user',
                    'Token expiry during active session',
                    'Network timeout during authentication'
                ]
            };
        }

        const systemPrompt = `You are a test automation expert. Generate comprehensive test cases including unit, integration, and edge case tests. Provide mock data and estimate coverage.`;

        const userPrompt = `Generate ${request.testFramework} tests for:

${request.codeSnippet ? `Code:\n${request.codeSnippet}` : ''}
${request.apiSpec ? `API Spec:\n${request.apiSpec}` : ''}
${request.userStory ? `User Story:\n${request.userStory}` : ''}

Framework: ${request.testFramework}
${request.coverageTarget ? `Coverage Target: ${request.coverageTarget}%` : ''}

Please provide:
1. Test cases with code
2. Mock data if needed
3. Coverage estimate
4. Edge cases to consider`;

        const content = await this.callAzureOpenAI(systemPrompt, userPrompt, 0.2);

        return {
            testCases: this.parseTestCases(content),
            mockData: this.parseMockData(content),
            coverageEstimate: this.extractCoverageEstimate(content),
            edgeCases: this.extractSection(content, 'Edge Cases'),
        };
    }

    async generateMocks(request: GenerateMocksRequest): Promise<GenerateMocksResponse> {
        if (this.mockMode) {
            return {
                html: `<div class="login-container">\n  <form class="login-form">\n    <h2>Sign In</h2>\n    <div class="form-group">\n      <label for="email">Email</label>\n      <input type="email" id="email" name="email" required />\n    </div>\n    <div class="form-group">\n      <label for="password">Password</label>\n      <input type="password" id="password" name="password" required />\n    </div>\n    <button type="submit" class="btn-primary">Login</button>\n    <a href="/forgot-password" class="forgot-link">Forgot password?</a>\n  </form>\n</div>`,
                css: `.login-container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  min-height: 100vh;\n  background: #f5f7fa;\n}\n.login-form {\n  background: white;\n  padding: 2rem;\n  border-radius: 8px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.1);\n  width: 100%;\n  max-width: 400px;\n}\n.form-group {\n  margin-bottom: 1rem;\n}\n.form-group label {\n  display: block;\n  margin-bottom: 0.25rem;\n  font-weight: 500;\n}\n.form-group input {\n  width: 100%;\n  padding: 0.5rem;\n  border: 1px solid #cbd5e0;\n  border-radius: 4px;\n}\n.btn-primary {\n  width: 100%;\n  padding: 0.75rem;\n  background: #2b6cb0;\n  color: white;\n  border: none;\n  border-radius: 4px;\n  cursor: pointer;\n}\n.forgot-link {\n  display: block;\n  text-align: center;\n  margin-top: 1rem;\n  color: #2b6cb0;\n}`,
                components: [
                    {
                        name: 'LoginForm',
                        code: `import React, { useState } from 'react';\n\ninterface LoginFormProps {\n  onSubmit: (email: string, password: string) => void;\n  loading?: boolean;\n  error?: string;\n}\n\nexport const LoginForm: React.FC<LoginFormProps> = ({ onSubmit, loading, error }) => {\n  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');\n\n  const handleSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    onSubmit(email, password);\n  };\n\n  return (\n    <form onSubmit={handleSubmit} className="login-form">\n      <h2>Sign In</h2>\n      {error && <div className="error">{error}</div>}\n      <div className="form-group">\n        <label htmlFor="email">Email</label>\n        <input\n          type="email"\n          id="email"\n          value={email}\n          onChange={(e) => setEmail(e.target.value)}\n          required\n        />\n      </div>\n      <div className="form-group">\n        <label htmlFor="password">Password</label>\n        <input\n          type="password"\n          id="password"\n          value={password}\n          onChange={(e) => setPassword(e.target.value)}\n          required\n        />\n      </div>\n      <button type="submit" disabled={loading} className="btn-primary">\n        {loading ? 'Signing in...' : 'Login'}\n      </button>\n    </form>\n  );\n};`,
                        props: [
                            { name: 'onSubmit', type: '(email: string, password: string) => void', required: true },
                            { name: 'loading', type: 'boolean', required: false },
                            { name: 'error', type: 'string', required: false }
                        ]
                    }
                ],
                storybookStories: [`export default {\n  title: 'Components/LoginForm',\n  component: LoginForm,\n};\n\nexport const Default = () => <LoginForm onSubmit={console.log} />;\nexport const Loading = () => <LoginForm onSubmit={console.log} loading />;\nexport const WithError = () => <LoginForm onSubmit={console.log} error="Invalid credentials" />;`]
            };
        }

        const systemPrompt = `You are a UI/UX developer. Generate HTML/CSS mockups and React components based on descriptions. Follow design system guidelines and accessibility best practices.`;

        const userPrompt = `Generate ${request.framework} components for:

${request.description}

Platform: ${request.platform}
${request.designSystem ? `Design System: ${request.designSystem}` : ''}
${request.existingComponents ? `Existing Components: ${request.existingComponents.join(', ')}` : ''}

Please provide:
1. HTML structure
2. CSS styling
3. React component code with props
4. Storybook stories if applicable`;

        const content = await this.callAzureOpenAI(systemPrompt, userPrompt, 0.4);

        return {
            html: this.extractCodeBlock(content, 'html'),
            css: this.extractCodeBlock(content, 'css'),
            components: this.parseComponents(content),
            storybookStories: this.extractCodeBlocks(content, 'tsx'),
        };
    }

    async reviewCode(request: CodeReviewRequest & { teamPreferences?: { accepted: string[]; rejected: string[] } }): Promise<CodeReviewResponse> {
        if (this.mockMode) {
            return {
                issues: [
                    {
                        severity: 'critical',
                        line: 12,
                        message: 'Password is stored in plain text - use bcrypt or Argon2 for hashing',
                        suggestion: 'Replace direct comparison with bcrypt.compare() and store hashed passwords',
                        category: 'security'
                    },
                    {
                        severity: 'warning',
                        line: 8,
                        message: 'No input validation on email field - susceptible to injection attacks',
                        suggestion: 'Add email format validation and sanitize inputs using a library like Joi or Zod',
                        category: 'security'
                    },
                    {
                        severity: 'warning',
                        line: 15,
                        message: 'No rate limiting on login endpoint - vulnerable to brute force attacks',
                        suggestion: 'Implement rate limiting middleware (e.g., express-rate-limit) on auth routes',
                        category: 'security'
                    },
                    {
                        severity: 'warning',
                        line: 22,
                        message: 'Error message reveals whether email exists - information leakage',
                        suggestion: 'Use generic error message: "Invalid credentials" for both invalid email and password',
                        category: 'security'
                    },
                    {
                        severity: 'info',
                        line: 5,
                        message: 'Missing JSDoc comments for function parameters and return type',
                        suggestion: 'Add JSDoc documentation: @param, @returns, @throws',
                        category: 'maintainability'
                    }
                ],
                score: 62,
                summary: 'The authentication code has critical security vulnerabilities including plain text password storage and lack of input validation. While the basic flow is correct, immediate attention is needed on security hardening before production deployment.'
            };
        }

        const systemPrompt = `You are a senior code reviewer. Analyze code for security vulnerabilities, performance issues, style violations, and maintainability concerns.

When you spot a fixable issue, ALSO emit a concrete code patch in "replacement_code" — this is the literal source text that should replace lines [start_line..line] on the new side of the diff. It must be valid, drop-in code (correct indentation, no diff markers like + or -). If the fix is purely conceptual and can't be expressed as a literal replacement, omit replacement_code.

You MUST respond with valid JSON only — no markdown, no extra text, just the JSON object.`;

        // Team-preferences context from past human feedback. Treat as soft guidance.
        let prefsBlock = '';
        if (request.teamPreferences) {
            const { accepted, rejected } = request.teamPreferences;
            if (accepted.length || rejected.length) {
                prefsBlock = `\nTeam preferences learned from past reviews on this codebase:\n`;
                if (rejected.length) {
                    prefsBlock += `\nPatterns the team has REJECTED (avoid flagging):\n` +
                        rejected.map(r => `- ${r}`).join('\n') + '\n';
                }
                if (accepted.length) {
                    prefsBlock += `\nPatterns the team has ACCEPTED (prioritize similar):\n` +
                        accepted.map(a => `- ${a}`).join('\n') + '\n';
                }
            }
        }

        const userPrompt = `Review the following ${request.language} code diff and respond with JSON in this exact shape:

{
  "score": <integer 0-100>,
  "summary": "<one concise paragraph>",
  "issues": [
    {
      "severity": "<critical|warning|info>",
      "line": <integer or null — the line in the diff where the issue ends>,
      "start_line": <integer or null — only if the issue spans multiple lines>,
      "message": "<clear description of the issue>",
      "suggestion": "<actionable fix in plain English>",
      "replacement_code": "<literal replacement code, or null if not expressible as a patch>",
      "category": "<security|performance|style|maintainability>"
    }
  ]
}
${prefsBlock}
${request.filePath ? `Files changed: ${request.filePath}\n` : ''}Code to review:
${request.code}`;

        const content = await this.callAzureOpenAI(systemPrompt, userPrompt, 0.1);

        try {
            // Strip markdown code fences if the model wraps JSON in them
            let jsonStr = content
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```\s*$/, '')
                .trim();

            // If JSON was truncated (token limit), close any open structures so parse can succeed
            if (!jsonStr.endsWith('}')) {
                // Close open array and object
                const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
                const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
                // Remove any trailing incomplete key/value
                jsonStr = jsonStr.replace(/,?\s*"[^"]*$/, '').replace(/,?\s*$/, '');
                jsonStr += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
            }

            const parsed = JSON.parse(jsonStr);
            return {
                issues: Array.isArray(parsed.issues) ? parsed.issues : [],
                score: typeof parsed.score === 'number' ? parsed.score : 50,
                summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            };
        } catch {
            console.warn('[Review] AI response was not valid JSON, falling back to regex parser. Response:', content.slice(0, 300));
            return {
                issues: this.parseIssues(content),
                score: this.extractScore(content),
                summary: this.extractFirstParagraph(content, 'Summary') || content.split('\n\n')[0] || '',
            };
        }
    }

    async generateDocumentation(request: GenerateDocsRequest): Promise<GenerateDocsResponse> {
        if (this.mockMode) {
            return {
                content: `# Authentication API Documentation\n\n## Overview\n\nThe Authentication API provides endpoints for user login, logout, and session management. All endpoints return JSON responses and use standard HTTP status codes.\n\n## Base URL\n\n\`\`\`\nhttps://api.example.com/v1/auth\n\`\`\`\n\n## Endpoints\n\n### POST /login\n\nAuthenticate a user with email and password.\n\n**Request Body:**\n\n| Field    | Type   | Required | Description          |\n|----------|--------|----------|----------------------|\n| email    | string | Yes      | User email address   |\n| password | string | Yes      | User password        |\n\n**Response (200 OK):**\n\n\`\`\`json\n{\n  \"token\": \"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...\",\n  \"refreshToken\": \"dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...\",\n  \"user\": {\n    \"id\": \"123\",\n    \"email\": \"user@example.com\",\n    \"role\": \"patient\"\n  }\n}\n\`\`\`\n\n**Error Responses:**\n\n| Status | Code              | Description                          |\n|--------|-------------------|--------------------------------------|\n| 400    | INVALID_INPUT     | Missing required fields              |\n| 401    | INVALID_CREDENTIALS | Email or password is incorrect     |\n| 423    | ACCOUNT_LOCKED    | Too many failed attempts             |\n\n### POST /logout\n\nInvalidate the current session token.\n\n**Headers:**\n\n| Header        | Value                  |\n|---------------|------------------------|\n| Authorization | Bearer {access_token}  |\n\n**Response (204 No Content)**\n\n## Security Considerations\n\n- All passwords must be hashed using bcrypt with cost factor 12\n- Tokens expire after 15 minutes; use refresh tokens for renewal\n- Implement rate limiting: 5 attempts per minute per IP\n- Use HTTPS in all environments\n\n## Error Handling\n\nAll errors follow this format:\n\n\`\`\`json\n{\n  \"error\": {\n    \"code\": \"ERROR_CODE\",\n    \"message\": \"Human-readable description\"\n  }\n}\n\`\`\``,
                format: 'markdown',
                sections: ['Overview', 'Base URL', 'Endpoints', 'Security Considerations', 'Error Handling']
            };
        }

        const systemPrompt = `You are a technical writer. Generate clear, comprehensive documentation for developers, users, or operations teams.`;

        const userPrompt = `Generate ${request.type} documentation for:

${request.code ? `Code:\n${request.code}` : ''}
${request.apiSpec ? `API Spec:\n${request.apiSpec}` : ''}

Type: ${request.type}
Audience: ${request.audience}

Please provide well-structured documentation with clear sections.`;

        const content = await this.callAzureOpenAI(systemPrompt, userPrompt, 0.3);

        return {
            content,
            format: 'markdown',
            sections: this.extractSections(content),
        };
    }

    // Helper methods for parsing LLM responses
    private parseUserStories(content: string): OptimizeRequirementsResponse['userStories'] {
        const stories: OptimizeRequirementsResponse['userStories'] = [];
        const matches = content.match(/User Story \d+:[\s\S]*?(?=User Story \d+:|$)/g);

        if (matches) {
            matches.forEach((match, index) => {
                const title = match.match(/Title:\s*(.+)/)?.[1] || `Story ${index + 1}`;
                const description = match.match(/Description:\s*([\s\S]*?)(?=Acceptance|$)/)?.[1]?.trim() || '';
                const criteria = match.match(/Acceptance Criteria:([\s\S]*?)(?=Priority|$)/)?.[1]
                    ?.split('\n')
                    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
                    .map(line => line.replace(/^[-*]\s*/, '').trim()) || [];

                stories.push({
                    id: `US-${index + 1}`,
                    title,
                    description,
                    acceptanceCriteria: criteria,
                    priority: 'medium',
                });
            });
        }

        return stories;
    }

    private parseTasks(content: string): SprintPlanResponse['tasks'] {
        const tasks: SprintPlanResponse['tasks'] = [];
        const matches = content.match(/Task \d+:[\s\S]*?(?=Task \d+:|$)/g);

        if (matches) {
            matches.forEach((match, index) => {
                const title = match.match(/Title:\s*(.+)/)?.[1] || `Task ${index + 1}`;
                const description = match.match(/Description:\s*([\s\S]*?)(?=Estimate|$)/)?.[1]?.trim() || '';
                const hours = parseInt(match.match(/Estimate:\s*(\d+)/)?.[1] || '4');

                tasks.push({
                    id: `TASK-${index + 1}`,
                    title,
                    description,
                    estimatedHours: hours,
                    dependencies: [],
                    risk: 'low',
                });
            });
        }

        return tasks;
    }

    private parseTestCases(content: string): GenerateTestsResponse['testCases'] {
        const cases: GenerateTestsResponse['testCases'] = [];
        const codeBlocks = content.match(/```[\w]*\n([\s\S]*?)```/g);

        if (codeBlocks) {
            codeBlocks.forEach((block, index) => {
                const code = block.replace(/```[\w]*\n/, '').replace(/```$/, '');
                cases.push({
                    name: `Test ${index + 1}`,
                    code,
                    type: 'unit',
                    description: '',
                });
            });
        }

        return cases;
    }

    private parseMockData(content: string): Record<string, unknown> | undefined {
        const mockBlock = content.match(/Mock Data:\s*```json\n([\s\S]*?)```/);
        if (mockBlock) {
            try {
                return JSON.parse(mockBlock[1]);
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    private parseComponents(content: string): GenerateMocksResponse['components'] {
        const components: GenerateMocksResponse['components'] = [];
        const matches = content.match(/Component \w+:[\s\S]*?(?=Component \w+:|$)/g);

        if (matches) {
            matches.forEach((match) => {
                const name = match.match(/Component (\w+):/)?.[1] || 'Unknown';
                const code = match.match(/```[\w]*\n([\s\S]*?)```/)?.[1] || '';

                components.push({
                    name,
                    code,
                    props: [],
                });
            });
        }

        return components;
    }

    private parseIssues(content: string): CodeReviewResponse['issues'] {
        const issues: CodeReviewResponse['issues'] = [];
        const matches = content.match(/-\s*\[\w+\][\s\S]*?(?=\n\s*-\s*\[|$)/g);

        if (matches) {
            matches.forEach((match) => {
                const severity = (match.match(/\[(\w+)\]/)?.[1] || 'info').toLowerCase() as CodeReviewResponse['issues'][0]['severity'];
                const message = match.replace(/-\s*\[\w+\]\s*/, '').split('\n')[0];

                issues.push({
                    severity: ['critical', 'warning', 'info'].includes(severity) ? severity : 'info',
                    message,
                    suggestion: match.match(/Suggestion:\s*(.+)/)?.[1] || '',
                    category: 'maintainability',
                });
            });
        }

        return issues;
    }

    private extractSection(content: string, sectionName: string): string[] {
        const regex = new RegExp(`${sectionName}:?\s*([\s\S]*?)(?=\n\n[A-Z]|$)`);
        const match = content.match(regex);
        if (match) {
            return match[1]
                .split('\n')
                .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
                .map(line => line.replace(/^[-*]\s*/, '').trim())
                .filter(line => line.length > 0);
        }
        return [];
    }

    private extractFirstParagraph(content: string, sectionName: string): string {
        const regex = new RegExp(`${sectionName}:?\s*([\s\S]*?)(?=\n\n|$)`);
        const match = content.match(regex);
        return match ? match[1].trim() : '';
    }

    private extractCodeBlock(content: string, language: string): string {
        const regex = new RegExp(`\`\`\`${language}\n([\s\S]*?)\`\`\``);
        const match = content.match(regex);
        return match ? match[1] : '';
    }

    private extractCodeBlocks(content: string, language: string): string[] {
        const regex = new RegExp(`\`\`\`${language}\n([\s\S]*?)\`\`\``, 'g');
        const blocks: string[] = [];
        let match;
        while ((match = regex.exec(content)) !== null) {
            blocks.push(match[1]);
        }
        return blocks;
    }

    private extractCoverageEstimate(content: string): number {
        const match = content.match(/coverage.*?([\d]+)%/i);
        return match ? parseInt(match[1]) : 0;
    }

    private extractScore(content: string): number {
        const match = content.match(/score.*?([\d]+)/i);
        return match ? parseInt(match[1]) : 0;
    }

    private extractSections(content: string): string[] {
        const matches = content.match(/^#{1,3}\s+(.+)$/gm);
        return matches ? matches.map(m => m.replace(/^#{1,3}\s+/, '')) : [];
    }

    async healthCheck(): Promise<{ status: string; openai: boolean }> {
        return {
            status: 'ok',
            openai: !this.mockMode,
        };
    }
}

export const sdlAgentService = new SDLAgentService();
