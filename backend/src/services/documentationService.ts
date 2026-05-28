import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ShadingType,
    NumberFormat,
    LevelFormat,
    convertInchesToTwip,
} from 'docx';
import { RequirementsArtifact } from './requirementsSchema';

// ── Shared helpers ──────────────────────────────────────────────────────────

function heading1(text: string): Paragraph {
    return new Paragraph({
        text,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
    });
}

function heading2(text: string): Paragraph {
    return new Paragraph({
        text,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 80 },
    });
}

function heading3(text: string): Paragraph {
    return new Paragraph({
        text,
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 180, after: 60 },
    });
}

function body(text: string): Paragraph {
    return new Paragraph({
        children: [new TextRun({ text, size: 22 })],
        spacing: { after: 80 },
    });
}

function bullet(text: string, level = 0): Paragraph {
    return new Paragraph({
        children: [new TextRun({ text, size: 22 })],
        bullet: { level },
        spacing: { after: 60 },
    });
}

function numbered(text: string, level = 0): Paragraph {
    return new Paragraph({
        children: [new TextRun({ text, size: 22 })],
        numbering: { reference: 'numbered-list', level },
        spacing: { after: 60 },
    });
}

function divider(): Paragraph {
    return new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        spacing: { before: 120, after: 120 },
    });
}

function emptyLine(): Paragraph {
    return new Paragraph({ text: '', spacing: { after: 80 } });
}

function metaRow(label: string, value: string): TableRow {
    return new TableRow({
        children: [
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
                width: { size: 20, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
                width: { size: 80, type: WidthType.PERCENTAGE },
            }),
        ],
    });
}

function metaTable(rows: Array<[string, string]>): Table {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(([l, v]) => metaRow(l, v)),
    });
}

function titlePage(title: string, subtitle: string, date: string): Paragraph[] {
    return [
        new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 56, color: '1F3864' })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 1200, after: 200 },
        }),
        new Paragraph({
            children: [new TextRun({ text: subtitle, size: 28, color: '4472C4', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
        }),
        new Paragraph({
            children: [new TextRun({ text: date, size: 22, color: '666666' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 },
        }),
        divider(),
    ];
}

const NUMBERED_LIST_CONFIG = {
    config: [{
        reference: 'numbered-list',
        levels: [
            {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: {
                    paragraph: {
                        indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                    },
                },
            },
        ],
    }],
};

// ── Requirements Document ──────────────────────────────────────────────────

export async function generateRequirementsDoc(artifact: RequirementsArtifact, runId: string): Promise<Buffer> {
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const sections: Paragraph[] = [
        ...titlePage(artifact.title, 'Software Requirements Specification', date),
        emptyLine(),

        // Document info table
        metaTable([
            ['Run ID', runId],
            ['Version', String(artifact.version ?? 1)],
            ['Source', artifact.source ?? 'dify'],
            ['Date', date],
        ]) as unknown as Paragraph,
        emptyLine(),

        divider(),
        heading1('1. User Stories'),
        ...artifact.user_stories.map((s, i) => numbered(`${s}`, 0)),

        divider(),
        heading1('2. Functional Requirements'),
        ...artifact.functional_requirements.map((r) => bullet(r)),

        ...(artifact.non_functional_requirements?.length
            ? [divider(), heading1('3. Non-Functional Requirements'), ...artifact.non_functional_requirements.map((r) => bullet(r))]
            : []),

        divider(),
        heading1('4. Acceptance Criteria'),
        ...artifact.acceptance_criteria.map((c) => bullet(c)),

        ...(artifact.assumptions?.length
            ? [divider(), heading1('5. Assumptions'), ...artifact.assumptions.map((a) => bullet(a))]
            : []),

        ...(artifact.out_of_scope?.length
            ? [divider(), heading1('6. Out of Scope'), ...artifact.out_of_scope.map((o) => bullet(o))]
            : []),

        ...(artifact.open_questions?.length
            ? [
                divider(),
                heading1('7. Open Questions'),
                body('The following questions remain open and must be resolved before implementation begins:'),
                ...artifact.open_questions.map((q) => bullet(q)),
              ]
            : []),

        divider(),
        new Paragraph({
            children: [new TextRun({ text: 'Generated by the Agentic SDLC Platform.', size: 18, color: '999999', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
    ];

    const doc = new Document({
        numbering: NUMBERED_LIST_CONFIG,
        sections: [{ children: sections as Paragraph[] }],
        styles: {
            default: {
                document: {
                    run: { font: 'Calibri', size: 22 },
                },
            },
        },
    });

    const buffer = await Packer.toBuffer(doc);
    return Buffer.from(buffer);
}

// ── Plan Document ──────────────────────────────────────────────────────────

export interface PlanArtifact {
    title: string;
    summary: string;
    objectives: string[];
    milestones: Array<{ name: string; description: string; target_date?: string }>;
    risks: Array<{ risk: string; mitigation: string; severity: 'low' | 'medium' | 'high' }>;
    dependencies: string[];
    technical_approach?: string;
    out_of_scope?: string[];
    version?: number;
    source?: string;
}

export async function generatePlanDoc(artifact: PlanArtifact, runId: string): Promise<Buffer> {
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const riskRows = artifact.risks.map(
        (r) =>
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.risk, size: 20 })] })] }),
                    new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: r.severity.toUpperCase(), bold: true, size: 20, color: r.severity === 'high' ? 'CC0000' : r.severity === 'medium' ? 'CC7700' : '007700' })] })],
                        width: { size: 15, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.mitigation, size: 20 })] })] }),
                ],
            }),
    );

    const riskTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Risk', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Severity', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Mitigation', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                ],
            }),
            ...riskRows,
        ],
    });

    const sections: Array<Paragraph | Table> = [
        ...titlePage(artifact.title, 'Project Plan', date),
        emptyLine(),
        metaTable([
            ['Run ID', runId],
            ['Version', String(artifact.version ?? 1)],
            ['Date', date],
        ]),
        emptyLine(),

        divider(),
        heading1('1. Executive Summary'),
        body(artifact.summary),

        divider(),
        heading1('2. Objectives'),
        ...artifact.objectives.map((o) => bullet(o)),

        divider(),
        heading1('3. Milestones'),
        ...artifact.milestones.flatMap((m) => [
            heading3(m.name + (m.target_date ? `  (${m.target_date})` : '')),
            body(m.description),
        ]),

        ...(artifact.technical_approach
            ? [divider(), heading1('4. Technical Approach'), body(artifact.technical_approach)]
            : []),

        ...(artifact.dependencies.length
            ? [divider(), heading1('5. Dependencies'), ...artifact.dependencies.map((d) => bullet(d))]
            : []),

        divider(),
        heading1('6. Risk Assessment'),
        riskTable,

        ...(artifact.out_of_scope?.length
            ? [emptyLine(), divider(), heading1('7. Out of Scope'), ...artifact.out_of_scope.map((o) => bullet(o))]
            : []),

        divider(),
        new Paragraph({
            children: [new TextRun({ text: 'Generated by the Agentic SDLC Platform.', size: 18, color: '999999', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
    ];

    const doc = new Document({
        numbering: NUMBERED_LIST_CONFIG,
        sections: [{ children: sections as Paragraph[] }],
        styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    });

    return Buffer.from(await Packer.toBuffer(doc));
}

// ── Plan Overview (non-technical) ─────────────────────────────────────────

export async function generatePlanOverviewDoc(artifact: PlanArtifact, _runId: string): Promise<Buffer> {
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const riskRows = artifact.risks.map(
        (r) =>
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.risk, size: 20 })] })] }),
                    new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: r.severity === 'high' ? 'High' : r.severity === 'medium' ? 'Medium' : 'Low', bold: true, size: 20, color: r.severity === 'high' ? 'CC0000' : r.severity === 'medium' ? 'CC7700' : '007700' })] })],
                        width: { size: 15, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.mitigation, size: 20 })] })] }),
                ],
            }),
    );

    const riskTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'What Could Go Wrong', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'How Serious', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'How We Will Handle It', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                ],
            }),
            ...riskRows,
        ],
    });

    const sections: Array<Paragraph | Table> = [
        ...titlePage(artifact.title, 'Project Plan Overview', date),
        emptyLine(),

        heading1('About This Document'),
        body('This document provides a plain-language summary of the project plan. It covers what we are trying to achieve, when key milestones will be reached, what we need to succeed, and what risks we are managing.'),

        divider(),
        heading1('Project Summary'),
        body(artifact.summary),

        divider(),
        heading1('What We Want to Achieve'),
        body('This project has the following goals:'),
        ...artifact.objectives.map((o) => bullet(o)),

        divider(),
        heading1('Timeline and Key Milestones'),
        body('The project will be delivered in the following phases:'),
        ...artifact.milestones.flatMap((m) => [
            heading3(m.name + (m.target_date ? `  —  ${m.target_date}` : '')),
            body(m.description),
        ]),

        ...(artifact.dependencies.length
            ? [
                divider(),
                heading1('What We Need to Succeed'),
                body('The following must be in place for this project to move forward:'),
                ...artifact.dependencies.map((d) => bullet(d)),
              ]
            : []),

        divider(),
        heading1('Risks and How We Will Handle Them'),
        body('We have identified the following risks and put plans in place to manage them:'),
        emptyLine(),
        riskTable,

        ...(artifact.out_of_scope?.length
            ? [
                emptyLine(),
                divider(),
                heading1('What Is Not In This Project'),
                body('The following items are not part of this project:'),
                ...artifact.out_of_scope.map((o) => bullet(o)),
              ]
            : []),

        divider(),
        new Paragraph({
            children: [new TextRun({ text: `Prepared ${date}  ·  Agentic SDLC Platform`, size: 18, color: '999999', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
    ];

    const doc = new Document({
        numbering: NUMBERED_LIST_CONFIG,
        sections: [{ children: sections as Paragraph[] }],
        styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    });

    return Buffer.from(await Packer.toBuffer(doc));
}

// ── Requirements Overview (non-technical) ─────────────────────────────────

export async function generateRequirementsOverviewDoc(artifact: RequirementsArtifact, _runId: string): Promise<Buffer> {
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const sections: Array<Paragraph | Table> = [
        ...titlePage(artifact.title, 'Project Overview', date),
        emptyLine(),

        heading1('About This Document'),
        body('This document provides a plain-language summary of what is being built, what it must do, and how success will be measured. It is written for business stakeholders and non-technical team members.'),

        divider(),
        heading1('What Our Users Will Be Able To Do'),
        body('The following describes the key actions and experiences users will have with this system:'),
        ...artifact.user_stories.map((s) => bullet(s)),

        divider(),
        heading1('What the System Will Do'),
        body('The system will deliver the following capabilities:'),
        ...artifact.functional_requirements.map((r) => bullet(r)),

        ...(artifact.non_functional_requirements?.length
            ? [
                divider(),
                heading1('Quality and Performance Standards'),
                body('The system must meet the following quality expectations:'),
                ...artifact.non_functional_requirements.map((r) => bullet(r)),
              ]
            : []),

        divider(),
        heading1('How We Will Know It Is Done'),
        body('The project will be considered complete when all of the following conditions are met:'),
        ...artifact.acceptance_criteria.map((c) => bullet(c)),

        ...(artifact.assumptions?.length
            ? [
                divider(),
                heading1('Assumptions We Are Making'),
                body('This project is based on the following assumptions:'),
                ...artifact.assumptions.map((a) => bullet(a)),
              ]
            : []),

        ...(artifact.out_of_scope?.length
            ? [
                divider(),
                heading1('What Is Not In This Project'),
                body('The following items will not be delivered as part of this project:'),
                ...artifact.out_of_scope.map((o) => bullet(o)),
              ]
            : []),

        ...(artifact.open_questions?.length
            ? [
                divider(),
                heading1('Questions Still To Be Answered'),
                body('The following questions need to be resolved before work can proceed:'),
                ...artifact.open_questions.map((q) => bullet(q)),
              ]
            : []),

        divider(),
        new Paragraph({
            children: [new TextRun({ text: `Prepared ${date}  ·  Agentic SDLC Platform`, size: 18, color: '999999', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
    ];

    const doc = new Document({
        numbering: NUMBERED_LIST_CONFIG,
        sections: [{ children: sections as Paragraph[] }],
        styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    });

    return Buffer.from(await Packer.toBuffer(doc));
}

// ── Design Document ────────────────────────────────────────────────────────

export interface DesignArtifact {
    title: string;
    overview: string;
    components: Array<{ name: string; responsibility: string; technology?: string }>;
    data_models: Array<{ name: string; fields: Array<{ field: string; type: string; description?: string }> }>;
    api_contracts: Array<{ method: string; path: string; description: string; request?: string; response?: string }>;
    diagrams?: Array<{ title: string; content: string; type: 'mermaid' | 'text' }>;
    adr?: Array<{ title: string; status: string; decision: string; rationale: string }>;
    version?: number;
    source?: string;
}

export async function generateDesignDoc(artifact: DesignArtifact, runId: string): Promise<Buffer> {
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const componentTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Component', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Responsibility', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Technology', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                ],
            }),
            ...artifact.components.map(
                (c) =>
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.name, bold: true, size: 20 })] })] }),
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.responsibility, size: 20 })] })] }),
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.technology ?? '—', size: 20 })] })] }),
                        ],
                    }),
            ),
        ],
    });

    const apiTable = artifact.api_contracts.length
        ? new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                  new TableRow({
                      children: [
                          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Method', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' }, width: { size: 12, type: WidthType.PERCENTAGE } }),
                          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Path', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' }, width: { size: 28, type: WidthType.PERCENTAGE } }),
                          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Description', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                      ],
                  }),
                  ...artifact.api_contracts.map(
                      (a) =>
                          new TableRow({
                              children: [
                                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: a.method, bold: true, size: 20, color: '1F3864' })] })] }),
                                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: a.path, font: 'Courier New', size: 18 })] })] }),
                                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: a.description, size: 20 })] })] }),
                              ],
                          }),
                  ),
              ],
          })
        : null;

    const sections: Array<Paragraph | Table> = [
        ...titlePage(artifact.title, 'Technical Design Document', date),
        emptyLine(),
        metaTable([
            ['Run ID', runId],
            ['Version', String(artifact.version ?? 1)],
            ['Date', date],
        ]),
        emptyLine(),

        divider(),
        heading1('1. Architecture Overview'),
        body(artifact.overview),

        divider(),
        heading1('2. Components'),
        componentTable,

        ...(artifact.data_models.length
            ? [
                emptyLine(),
                divider(),
                heading1('3. Data Models'),
                ...artifact.data_models.flatMap((m) => [
                    heading2(m.name),
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Field', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Type', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Description', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                                ],
                            }),
                            ...m.fields.map(
                                (f) =>
                                    new TableRow({
                                        children: [
                                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: f.field, font: 'Courier New', size: 18 })] })] }),
                                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: f.type, italics: true, size: 20 })] })] }),
                                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: f.description ?? '', size: 20 })] })] }),
                                        ],
                                    }),
                            ),
                        ],
                    }),
                    emptyLine(),
                ]),
              ]
            : []),

        ...(apiTable
            ? [divider(), heading1('4. API Contracts'), apiTable, emptyLine()]
            : []),

        ...(artifact.diagrams?.length
            ? [
                divider(),
                heading1('5. Diagrams'),
                ...artifact.diagrams.flatMap((d) => [
                    heading2(d.title),
                    new Paragraph({
                        children: [new TextRun({ text: d.content, font: 'Courier New', size: 18 })],
                        spacing: { after: 120 },
                        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }, left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
                    }),
                ]),
              ]
            : []),

        ...(artifact.adr?.length
            ? [
                divider(),
                heading1('6. Architecture Decision Records'),
                ...artifact.adr.flatMap((a) => [
                    heading2(`${a.title} [${a.status}]`),
                    heading3('Decision'),
                    body(a.decision),
                    heading3('Rationale'),
                    body(a.rationale),
                ]),
              ]
            : []),

        divider(),
        new Paragraph({
            children: [new TextRun({ text: 'Generated by the Agentic SDLC Platform.', size: 18, color: '999999', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
    ];

    const doc = new Document({
        numbering: NUMBERED_LIST_CONFIG,
        sections: [{ children: sections as Paragraph[] }],
        styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    });

    return Buffer.from(await Packer.toBuffer(doc));
}

// ── Design Overview (non-technical) ───────────────────────────────────────

export async function generateDesignOverviewDoc(artifact: DesignArtifact, _runId: string): Promise<Buffer> {
    const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const componentTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Part of the System', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' }, width: { size: 30, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'What It Does', bold: true, size: 20 })] })], shading: { type: ShadingType.CLEAR, fill: 'E8EEF8' } }),
                ],
            }),
            ...artifact.components.map(
                (c) =>
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.name, bold: true, size: 20 })] })] }),
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.responsibility, size: 20 })] })] }),
                        ],
                    }),
            ),
        ],
    });

    const sections: Array<Paragraph | Table> = [
        ...titlePage(artifact.title, 'Solution Overview', date),
        emptyLine(),

        heading1('About This Document'),
        body('This document provides a plain-language description of how the solution will be built. It explains what the main parts of the system are, what information will be stored, and the key decisions that have been made. It is written for business stakeholders and non-technical team members.'),

        divider(),
        heading1('How It Works'),
        body(artifact.overview),

        divider(),
        heading1('Main Parts of the System'),
        body('The solution is made up of the following key parts:'),
        emptyLine(),
        componentTable,

        ...(artifact.data_models.length
            ? [
                emptyLine(),
                divider(),
                heading1('Information the System Will Manage'),
                body('The system will store and manage the following types of information:'),
                ...artifact.data_models.map((m) => bullet(m.name)),
              ]
            : []),

        ...(artifact.adr?.length
            ? [
                divider(),
                heading1('Key Decisions Made'),
                body('The following important decisions have been made during the design of this solution:'),
                ...artifact.adr.flatMap((a) => [
                    heading3(a.title),
                    body(a.rationale),
                ]),
              ]
            : []),

        divider(),
        new Paragraph({
            children: [new TextRun({ text: `Prepared ${date}  ·  Agentic SDLC Platform`, size: 18, color: '999999', italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
    ];

    const doc = new Document({
        numbering: NUMBERED_LIST_CONFIG,
        sections: [{ children: sections as Paragraph[] }],
        styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    });

    return Buffer.from(await Packer.toBuffer(doc));
}
