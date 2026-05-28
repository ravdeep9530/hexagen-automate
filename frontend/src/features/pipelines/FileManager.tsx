import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { tokens } from './design';

const API_URL = process.env.REACT_APP_API_URL || '/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size?: number;
    children?: TreeNode[];
}

// ─── Language detection ───────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html',
    sql: 'sql', sh: 'bash', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    txt: 'text', env: 'bash', mjs: 'javascript', cjs: 'javascript',
};

const FILE_ICON: Record<string, string> = {
    ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️', py: '🐍', json: '{}',
    md: '📝', css: '🎨', html: '🌐', sql: '🗄️', sh: '💻', yaml: '⚙️',
    yml: '⚙️', toml: '⚙️', txt: '📄', mjs: '🟨', wasm: '⬛', lock: '🔒',
};

function fileIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return FILE_ICON[ext] ?? '📄';
}

function fileLang(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return EXT_LANG[ext] ?? 'text';
}

function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Tree node component ──────────────────────────────────────────────────────

function TreeItem({
    node, depth, selected, onSelect,
}: {
    node: TreeNode; depth: number; selected: string | null; onSelect: (path: string) => void;
}) {
    const [open, setOpen] = useState(depth < 2);
    const isSelected = node.type === 'file' && node.path === selected;

    if (node.type === 'dir') {
        return (
            <div>
                <button
                    onClick={() => setOpen(v => !v)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        width: '100%', textAlign: 'left', background: 'transparent',
                        border: 'none', cursor: 'pointer',
                        padding: `4px 8px 4px ${8 + depth * 14}px`,
                        fontSize: 12, color: tokens.color.text,
                        borderRadius: 4,
                    }}
                >
                    <span style={{ fontSize: 10, color: tokens.color.textMuted, width: 12 }}>
                        {open ? '▾' : '▸'}
                    </span>
                    <span style={{ fontSize: 13 }}>📁</span>
                    <span style={{ fontWeight: 600 }}>{node.name}</span>
                </button>
                {open && node.children?.map(child => (
                    <TreeItem key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
                ))}
            </div>
        );
    }

    return (
        <button
            onClick={() => onSelect(node.path)}
            style={{
                display: 'flex', alignItems: 'center', gap: 5,
                width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                padding: `4px 8px 4px ${8 + depth * 14}px`,
                fontSize: 12,
                background: isSelected ? tokens.color.primarySoft : 'transparent',
                color: isSelected ? tokens.color.primary : tokens.color.text,
                borderRadius: 4,
                fontWeight: isSelected ? 600 : 400,
            }}
        >
            <span style={{ width: 12 }} />
            <span style={{ fontSize: 13 }}>{fileIcon(node.name)}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
            </span>
            {node.size != null ? (
                <span style={{ fontSize: 10, color: tokens.color.textSubtle, flexShrink: 0 }}>
                    {fmtSize(node.size)}
                </span>
            ) : null}
        </button>
    );
}

// ─── Code viewer ──────────────────────────────────────────────────────────────

function CodeViewer({ content, lang, truncated }: { content: string; lang: string; truncated: boolean }) {
    const lines = content.split('\n');
    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {truncated ? (
                <div style={{
                    padding: '4px 12px', background: tokens.color.warningSoft,
                    fontSize: 11, color: '#92400e', borderBottom: `1px solid ${tokens.color.border}`,
                }}>
                    ⚠ File truncated at 256 KB
                </div>
            ) : null}
            <div style={{ display: 'flex', flex: 1, overflow: 'auto', background: '#0f172a' }}>
                {/* Line numbers */}
                <div style={{
                    padding: '12px 8px', minWidth: 44, textAlign: 'right',
                    background: '#0a1020', color: '#334155',
                    fontSize: 11, fontFamily: tokens.font.mono, lineHeight: 1.6,
                    userSelect: 'none', flexShrink: 0,
                    borderRight: '1px solid #1e293b',
                }}>
                    {lines.map((_, i) => (
                        <div key={i}>{i + 1}</div>
                    ))}
                </div>
                {/* Code */}
                <pre style={{
                    margin: 0, padding: '12px 16px', flex: 1,
                    fontSize: 12, lineHeight: 1.6,
                    fontFamily: tokens.font.mono,
                    color: '#e2e8f0', whiteSpace: 'pre', overflowX: 'visible',
                    background: 'transparent',
                }}>
                    {content}
                </pre>
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
    runId: string;
}

export function FileManager({ runId }: Props) {
    const [tree, setTree] = useState<TreeNode[] | null>(null);
    const [treeError, setTreeError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<{ content: string; lang: string; truncated: boolean } | null>(null);
    const [fileLoading, setFileLoading] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!runId) return;
        axios.get(`${API_URL}/pipelines/${runId}/source-tree`)
            .then(r => { setTree(r.data); setTreeError(null); })
            .catch(e => setTreeError(e?.response?.data?.error || e.message));
    }, [runId]);

    const openFile = useCallback(async (filePath: string) => {
        setSelected(filePath);
        setFileLoading(true);
        try {
            const r = await axios.get(`${API_URL}/pipelines/${runId}/source-file`, { params: { path: filePath } });
            setFileContent({ content: r.data.content, lang: fileLang(filePath), truncated: r.data.truncated });
        } catch (e: any) {
            setFileContent({ content: `Error loading file: ${e?.response?.data?.error || e.message}`, lang: 'text', truncated: false });
        } finally {
            setFileLoading(false);
        }
    }, [runId]);

    // Flatten tree for search
    function flatFiles(nodes: TreeNode[]): TreeNode[] {
        const out: TreeNode[] = [];
        for (const n of nodes) {
            if (n.type === 'file') out.push(n);
            else if (n.children) out.push(...flatFiles(n.children));
        }
        return out;
    }

    const searchResults = search.trim() && tree
        ? flatFiles(tree).filter(f => f.path.toLowerCase().includes(search.toLowerCase()))
        : null;

    if (treeError) {
        return (
            <div style={{
                padding: '16px', color: tokens.color.textMuted, fontSize: 13,
                border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md,
                background: tokens.color.slateSoft,
            }}>
                No source tree available yet — run the pipeline to generate code.
            </div>
        );
    }

    if (!tree) {
        return (
            <div style={{ padding: '16px', color: tokens.color.textMuted, fontSize: 12 }}>
                Loading file tree…
            </div>
        );
    }

    const totalFiles = flatFiles(tree).length;

    return (
        <div style={{
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.lg,
            overflow: 'hidden',
            height: 520,
            display: 'flex', flexDirection: 'column',
            background: 'white',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                background: tokens.color.bg,
                borderBottom: `1px solid ${tokens.color.border}`,
                flexShrink: 0,
            }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: tokens.color.text }}>
                    📂 Source Files
                </span>
                <span style={{
                    fontSize: 11, color: tokens.color.textMuted,
                    background: tokens.color.slateSoft, padding: '1px 7px',
                    borderRadius: tokens.radius.pill,
                }}>
                    {totalFiles} files
                </span>
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search files…"
                    style={{
                        marginLeft: 'auto', width: 200,
                        padding: '4px 8px', fontSize: 12,
                        border: `1px solid ${tokens.color.border}`,
                        borderRadius: tokens.radius.sm,
                        background: 'white', color: tokens.color.text,
                        outline: 'none',
                    }}
                />
            </div>

            {/* Body: tree + viewer */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* File tree */}
                <div style={{
                    width: 240, flexShrink: 0,
                    overflow: 'auto',
                    borderRight: `1px solid ${tokens.color.border}`,
                    background: '#f8fafc',
                    padding: '6px 0',
                }}>
                    {searchResults ? (
                        searchResults.length === 0 ? (
                            <div style={{ padding: '12px', fontSize: 12, color: tokens.color.textMuted }}>
                                No files match "{search}"
                            </div>
                        ) : searchResults.map(f => (
                            <button
                                key={f.path}
                                onClick={() => openFile(f.path)}
                                style={{
                                    display: 'block', width: '100%', textAlign: 'left',
                                    padding: '4px 12px', border: 'none', cursor: 'pointer',
                                    background: f.path === selected ? tokens.color.primarySoft : 'transparent',
                                    color: f.path === selected ? tokens.color.primary : tokens.color.text,
                                    fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}
                                title={f.path}
                            >
                                {fileIcon(f.name)} {f.path}
                            </button>
                        ))
                    ) : (
                        tree.map(node => (
                            <TreeItem key={node.path} node={node} depth={0} selected={selected} onSelect={openFile} />
                        ))
                    )}
                </div>

                {/* Code viewer */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {selected ? (
                        <>
                            {/* File tab */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 12px',
                                background: '#0a1020',
                                borderBottom: '1px solid #1e293b',
                                flexShrink: 0,
                            }}>
                                <span style={{ fontSize: 13 }}>{fileIcon(selected.split('/').pop() ?? '')}</span>
                                <span style={{
                                    fontSize: 12, fontFamily: tokens.font.mono, color: '#94a3b8',
                                }}>
                                    {selected}
                                </span>
                                {fileLoading ? (
                                    <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>loading…</span>
                                ) : fileContent ? (
                                    <span style={{
                                        fontSize: 10, marginLeft: 'auto',
                                        color: '#334155', background: '#1e293b',
                                        padding: '2px 7px', borderRadius: tokens.radius.pill,
                                        fontFamily: tokens.font.mono,
                                    }}>
                                        {fileContent.lang}
                                    </span>
                                ) : null}
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                {fileLoading ? (
                                    <div style={{ padding: 20, color: '#64748b', fontSize: 12, background: '#0f172a', height: '100%' }}>
                                        Loading…
                                    </div>
                                ) : fileContent ? (
                                    <CodeViewer content={fileContent.content} lang={fileContent.lang} truncated={fileContent.truncated} />
                                ) : null}
                            </div>
                        </>
                    ) : (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: '#0f172a', color: '#334155', fontSize: 13,
                            gap: 8,
                        }}>
                            <span style={{ fontSize: 32 }}>📂</span>
                            <span>Select a file to view its contents</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
