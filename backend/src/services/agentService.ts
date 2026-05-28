import { callAzureChat, isAzureConfigured } from '../config/azure';

export interface Agent {
    id: string;
    name: string;
    type: 'clinical-documentation' | 'prior-authorization';
    status: 'active' | 'inactive' | 'error';
    description: string;
    lastPing: Date;
    config: Record<string, unknown>;
}

export interface ClinicalDocRequest {
    patientId: string;
    encounterId: string;
    transcript?: string;
    audioUrl?: string;
    noteType: 'soap' | 'progress' | 'discharge';
}

export interface ClinicalDocResponse {
    note: string;
    suggestedCodes: Array<{
        code: string;
        description: string;
        confidence: number;
    }>;
    confidence: number;
    citations: string[];
}

export interface PriorAuthRequest {
    patientId: string;
    providerId: string;
    serviceType: string;
    diagnosisCodes: string[];
    procedureCodes: string[];
    clinicalJustification: string;
    payerId: string;
}

export interface PriorAuthResponse {
    requestId: string;
    status: 'submitted' | 'pending' | 'approved' | 'denied';
    submittedDate: Date;
    estimatedResponseDate: Date;
    supportingDocuments: string[];
}

class AgentService {
    async generateClinicalNote(request: ClinicalDocRequest): Promise<ClinicalDocResponse> {
        const systemPrompt = `You are a clinical documentation assistant. Generate accurate, HIPAA-compliant clinical notes based on encounter transcripts.
        Always include appropriate citations and confidence scores. Format notes in standard SOAP format when requested.`;

        const userPrompt = `Generate a ${request.noteType} note for patient ${request.patientId}, encounter ${request.encounterId}.

Transcript: ${request.transcript || 'No transcript provided'}

Please provide:
1. Structured clinical note
2. Suggested ICD-10 and CPT codes with confidence scores
3. Key citations from clinical guidelines`;

        try {
            const content = await callAzureChat(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                0.3
            );
            return { note: content, suggestedCodes: [], confidence: 0.95, citations: [] };
        } catch (error) {
            console.error('Clinical note generation failed:', error);
            throw new Error('Failed to generate clinical note');
        }
    }

    async processPriorAuthorization(request: PriorAuthRequest): Promise<PriorAuthResponse> {
        const systemPrompt = `You are a prior authorization specialist. Review clinical information and generate comprehensive prior authorization requests.
        Ensure all clinical justifications are evidence-based and properly formatted for payer requirements.`;

        const userPrompt = `Process prior authorization request:
- Patient: ${request.patientId}
- Service: ${request.serviceType}
- Diagnosis: ${request.diagnosisCodes.join(', ')}
- Procedure: ${request.procedureCodes.join(', ')}
- Justification: ${request.clinicalJustification}

Generate:
1. Completed PA form content
2. Supporting clinical documentation
3. Evidence-based justification`;

        try {
            const content = await callAzureChat(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                0.2
            );
            return {
                requestId: `PA-${Date.now()}`,
                status: 'submitted',
                submittedDate: new Date(),
                estimatedResponseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                supportingDocuments: [content],
            };
        } catch (error) {
            console.error('Prior authorization processing failed:', error);
            throw new Error('Failed to process prior authorization');
        }
    }

    async healthCheck(): Promise<{ status: string; openai: boolean }> {
        return { status: 'ok', openai: isAzureConfigured() };
    }
}

export const agentService = new AgentService();
