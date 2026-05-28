import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { tokens } from '../features/pipelines/design';

const API_URL = process.env.REACT_APP_API_URL || '/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceMember {
    id: number;
    username: string;
    display_name: string;
    email: string | null;
    avatar_color: string;
}

interface SprintTask {
    id: string;
    title: string;
    description?: string;
    acceptance_criteria?: string[];
    files_likely_touched?: string[];
    estimate_points?: number;
    dependencies?: string[];
    sprint_assignment?: number;
    // merged from sprint_task_assignments
    assignee: string;
    notes: string | null;
    assignment_updated_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avatarInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function Avatar({ member, size = 28 }: { member: WorkspaceMember; size?: number }) {
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: member.avatar_color, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
            border: '2px solid white',
        }}>
            {member.username === 'system'
                ? <span style={{ fontSize: size * 0.55 }}>⚙</span>
                : avatarInitials(member.display_name)
            }
        </div>
    );
}

function PointsBadge({ points }: { points?: number }) {
    if (!points) return null;
    return (
        <span style={{
            fontSize: 11, fontWeight: 600,
            color: tokens.color.primary,
            background: tokens.color.primarySoft,
            borderRadius: tokens.radius.pill,
            padding: '2px 8px',
        }}>
            {points}sp
        </span>
    );
}

function HumanBadge() {
    return (
        <span style={{
            fontSize: 11, fontWeight: 600,
            color: '#92400e',
            background: tokens.color.warningSoft,
            borderRadius: tokens.radius.pill,
            padding: '2px 8px',
        }}>
            Manual
        </span>
    );
}

// ─── Add member modal ─────────────────────────────────────────────────────────

const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#059669', '#d97706', '#dc2626', '#0891b2', '#64748b'];

function AddMemberModal({ onClose, onAdded }: { onClose: () => void; onAdded: (m: WorkspaceMember) => void }) {
    const [username, setUsername] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [color, setColor] = useState(PALETTE[1]);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function handleAdd() {
        if (!username.trim() || !displayName.trim()) {
            setErr('Username and display name are required');
            return;
        }
        setSaving(true);
        setErr(null);
        try {
            const r = await axios.post(`${API_URL}/workspace/members`, {
                username: username.trim(),
                display_name: displayName.trim(),
                email: email.trim() || null,
                avatar_color: color,
            });
            onAdded(r.data);
            onClose();
        } catch (e: any) {
            setErr(e?.response?.data?.error ?? e.message ?? 'Failed to add member');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(15,23,42,.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={onClose}>
            <div style={{
                background: '#fff', borderRadius: tokens.radius.lg,
                boxShadow: tokens.shadow.lg,
                padding: 28, width: 380, maxWidth: '90vw',
            }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: 16, fontWeight: 700, color: tokens.color.text, marginBottom: 20 }}>
                    Add team member
                </div>

                {err && (
                    <div style={{
                        marginBottom: 12, padding: '8px 12px',
                        background: tokens.color.dangerSoft, borderRadius: tokens.radius.sm,
                        fontSize: 13, color: tokens.color.danger,
                    }}>{err}</div>
                )}

                <label style={labelStyle}>Username</label>
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. jsmith" style={inputStyle} />

                <label style={labelStyle}>Display name</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Jane Smith" style={inputStyle} />

                <label style={labelStyle}>Email (optional)</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" style={inputStyle} />

                <label style={labelStyle}>Avatar colour</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {PALETTE.map(c => (
                        <button key={c} onClick={() => setColor(c)} style={{
                            width: 28, height: 28, borderRadius: '50%', background: c, border: 'none',
                            cursor: 'pointer',
                            outline: c === color ? `3px solid ${tokens.color.text}` : 'none',
                            outlineOffset: 2,
                        }} />
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={onClose} style={ghostBtn}>Cancel</button>
                    <button onClick={handleAdd} disabled={saving} style={primaryBtn}>
                        {saving ? 'Adding…' : 'Add member'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

interface TaskCardProps {
    task: SprintTask;
    members: WorkspaceMember[];
    taskMap: Map<string, SprintTask>;
    onAssigneeChange: (taskId: string, assignee: string) => void;
    saving: boolean;
}

function TaskCard({ task, members, taskMap, onAssigneeChange, saving }: TaskCardProps) {
    const isHuman = task.assignee !== 'system';
    const assignedMember = members.find(m => m.username === task.assignee) ?? members[0];

    // Are any dependencies human-assigned?
    const humanBlockedDeps = (task.dependencies ?? []).filter(depId => {
        const dep = taskMap.get(depId);
        return dep && dep.assignee !== 'system';
    });
    const isBlockedByHuman = !isHuman && humanBlockedDeps.length > 0;

    return (
        <div style={{
            padding: '14px 16px',
            background: isHuman ? tokens.color.warningSoft : tokens.color.card,
            border: `1px solid ${isHuman ? tokens.color.warning + '66' : isBlockedByHuman ? tokens.color.warning + '44' : tokens.color.border}`,
            borderRadius: tokens.radius.md,
            boxShadow: tokens.shadow.sm,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
        }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{
                    fontSize: 11, fontWeight: 700, color: tokens.color.textSubtle,
                    fontFamily: tokens.font.mono, flexShrink: 0, paddingTop: 2,
                }}>
                    {task.id}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: tokens.color.text, flex: 1, lineHeight: 1.35 }}>
                    {task.title}
                </span>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    <PointsBadge points={task.estimate_points} />
                    {isHuman && <HumanBadge />}
                </div>
            </div>

            {/* Description */}
            {task.description && (
                <p style={{
                    margin: 0, fontSize: 12, color: tokens.color.textMuted,
                    lineHeight: 1.5,
                }}>
                    {task.description}
                </p>
            )}

            {/* Dependencies */}
            {task.dependencies && task.dependencies.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: tokens.color.textSubtle }}>Depends on:</span>
                    {task.dependencies.map(dep => {
                        const depTask = taskMap.get(dep);
                        const depIsHuman = depTask?.assignee !== 'system';
                        return (
                            <span key={dep} style={{
                                fontSize: 11, padding: '1px 7px',
                                borderRadius: tokens.radius.pill,
                                background: depIsHuman ? tokens.color.warningSoft : tokens.color.slateSoft,
                                color: depIsHuman ? '#92400e' : tokens.color.textMuted,
                                fontFamily: tokens.font.mono,
                                border: `1px solid ${depIsHuman ? tokens.color.warning + '55' : tokens.color.border}`,
                            }}>
                                {dep}
                                {depIsHuman ? ' 👤' : ''}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* Blocked-by-human warning */}
            {isBlockedByHuman && (
                <div style={{
                    fontSize: 12, color: '#92400e',
                    background: tokens.color.warningSoft,
                    border: `1px solid ${tokens.color.warning}55`,
                    borderRadius: tokens.radius.sm,
                    padding: '5px 10px',
                }}>
                    System will wait for human dependencies: {humanBlockedDeps.join(', ')}
                </div>
            )}

            {/* Assignee row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                {assignedMember && <Avatar member={assignedMember} size={22} />}
                <select
                    value={task.assignee}
                    onChange={e => onAssigneeChange(task.id, e.target.value)}
                    disabled={saving}
                    style={{
                        fontSize: 12, padding: '3px 8px',
                        border: `1px solid ${tokens.color.border}`,
                        borderRadius: tokens.radius.sm,
                        background: '#fff',
                        color: tokens.color.text,
                        cursor: 'pointer',
                        fontFamily: tokens.font.body,
                    }}
                >
                    {members.map(m => (
                        <option key={m.username} value={m.username}>
                            {m.username === 'system' ? '⚙ System (AI)' : `👤 ${m.display_name}`}
                        </option>
                    ))}
                </select>
                {isHuman && (
                    <span style={{ fontSize: 11, color: '#92400e' }}>
                        System will skip this task
                    </span>
                )}
            </div>
        </div>
    );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

interface Props {
    runId: string;
    onBack: () => void;
}

export function SprintPlannerScreen({ runId, onBack }: Props) {
    const [tasks, setTasks] = useState<SprintTask[]>([]);
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [showAddMember, setShowAddMember] = useState(false);
    const [filter, setFilter] = useState<'all' | 'system' | 'human'>('all');

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [tasksRes, membersRes] = await Promise.all([
                axios.get(`${API_URL}/pipelines/${runId}/sprint-tasks`),
                axios.get(`${API_URL}/workspace/members`),
            ]);
            setTasks(tasksRes.data.tickets ?? []);
            setMembers(membersRes.data ?? []);
        } catch (e: any) {
            setLoadError(e?.response?.data?.error ?? e.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [runId]);

    useEffect(() => { load(); }, [load]);

    async function handleAssigneeChange(taskId: string, assignee: string) {
        setSavingId(taskId);
        // Optimistic update
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, assignee } : t));
        try {
            await axios.put(`${API_URL}/pipelines/${runId}/sprint-tasks/${taskId}`, { assignee });
        } catch (e: any) {
            // Revert on failure
            load();
        } finally {
            setSavingId(null);
        }
    }

    function handleMemberAdded(m: WorkspaceMember) {
        setMembers(prev => [...prev, m]);
    }

    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const humanCount = tasks.filter(t => t.assignee !== 'system').length;
    const systemCount = tasks.filter(t => t.assignee === 'system').length;

    const filteredTasks = tasks.filter(t => {
        if (filter === 'system') return t.assignee === 'system';
        if (filter === 'human') return t.assignee !== 'system';
        return true;
    });

    // Group by sprint_assignment for display
    const sprints = Array.from(new Set(tasks.map(t => t.sprint_assignment ?? 1))).sort((a, b) => a - b);

    if (loading) return (
        <div style={{ padding: 40, color: tokens.color.textMuted, fontSize: 14 }}>Loading sprint tasks…</div>
    );

    if (loadError) return (
        <div style={{ padding: 40, color: tokens.color.danger, fontSize: 14 }}>
            <strong>Error:</strong> {loadError}
            <br />
            <button onClick={load} style={{ ...ghostBtn, marginTop: 12 }}>Retry</button>
        </div>
    );

    return (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 64px', fontFamily: tokens.font.body }}>
            {showAddMember && (
                <AddMemberModal onClose={() => setShowAddMember(false)} onAdded={handleMemberAdded} />
            )}

            {/* Sticky header */}
            <div style={{
                position: 'sticky', top: 0, zIndex: 10,
                background: tokens.color.bg,
                borderBottom: `1px solid ${tokens.color.border}`,
                padding: '14px 0 12px',
                display: 'flex', alignItems: 'center', gap: 12,
                marginBottom: 24,
            }}>
                <button onClick={onBack} style={ghostBtn}>← Back to Pipeline</button>
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: tokens.color.text }}>Sprint Planner</span>
                    <span style={{ marginLeft: 10, fontSize: 12, color: tokens.color.textMuted }}>
                        {tasks.length} tasks
                    </span>
                </div>
                <button onClick={() => setShowAddMember(true)} style={primaryBtn}>+ Add member</button>
            </div>

            {/* Team members strip */}
            <div style={{
                padding: '14px 18px',
                background: tokens.color.card,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.lg,
                boxShadow: tokens.shadow.sm,
                marginBottom: 20,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.color.textMuted }}>
                    Team
                </span>
                {members.map(m => (
                    <div key={m.username} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Avatar member={m} size={26} />
                        <span style={{ fontSize: 12, color: tokens.color.text }}>
                            {m.display_name}
                        </span>
                    </div>
                ))}
            </div>

            {/* Summary stats */}
            <div style={{
                display: 'flex', gap: 12, marginBottom: 20,
            }}>
                {[
                    { label: 'Total', value: tasks.length, color: tokens.color.primary, bg: tokens.color.primarySoft },
                    { label: 'System (AI)', value: systemCount, color: tokens.color.success, bg: tokens.color.successSoft },
                    { label: 'Manual', value: humanCount, color: '#92400e', bg: tokens.color.warningSoft },
                ].map(s => (
                    <div key={s.label} style={{
                        flex: 1, padding: '12px 16px',
                        background: s.bg, borderRadius: tokens.radius.md,
                        border: `1px solid ${s.color}22`,
                    }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: 12, color: s.color, fontWeight: 500 }}>{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                {(['all', 'system', 'human'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{
                        padding: '5px 14px', borderRadius: tokens.radius.pill,
                        border: `1px solid ${filter === f ? tokens.color.primary : tokens.color.border}`,
                        background: filter === f ? tokens.color.primarySoft : 'transparent',
                        color: filter === f ? tokens.color.primary : tokens.color.textMuted,
                        fontSize: 12, fontWeight: filter === f ? 600 : 400,
                        cursor: 'pointer',
                    }}>
                        {f === 'all' ? 'All tasks' : f === 'system' ? '⚙ System' : '👤 Manual'}
                    </button>
                ))}
            </div>

            {/* Grouped by sprint */}
            {sprints.map(sprintNum => {
                const sprintTasks = filteredTasks.filter(t => (t.sprint_assignment ?? 1) === sprintNum);
                if (sprintTasks.length === 0) return null;
                return (
                    <div key={sprintNum} style={{ marginBottom: 32 }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
                        }}>
                            <span style={{
                                fontSize: 12, fontWeight: 700,
                                textTransform: 'uppercase', letterSpacing: '0.06em',
                                color: tokens.color.textMuted,
                            }}>
                                Sprint {sprintNum}
                            </span>
                            <span style={{
                                fontSize: 11, fontWeight: 600,
                                color: tokens.color.primary, background: tokens.color.primarySoft,
                                borderRadius: tokens.radius.pill, padding: '1px 8px',
                            }}>
                                {sprintTasks.length} task{sprintTasks.length !== 1 ? 's' : ''}
                            </span>
                            <div style={{ flex: 1, height: 1, background: tokens.color.border }} />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {sprintTasks.map(task => (
                                <TaskCard
                                    key={task.id}
                                    task={task}
                                    members={members}
                                    taskMap={taskMap}
                                    onAssigneeChange={handleAssigneeChange}
                                    saving={savingId === task.id}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}

            {filteredTasks.length === 0 && (
                <div style={{
                    padding: '40px 0', textAlign: 'center',
                    color: tokens.color.textMuted, fontSize: 14,
                }}>
                    No tasks match the current filter.
                </div>
            )}

            {/* Info banner if any human tasks */}
            {humanCount > 0 && (
                <div style={{
                    marginTop: 24, padding: '12px 16px',
                    background: tokens.color.warningSoft,
                    border: `1px solid ${tokens.color.warning}66`,
                    borderRadius: tokens.radius.md,
                    fontSize: 13, color: '#92400e',
                    lineHeight: 1.6,
                }}>
                    <strong>{humanCount} task{humanCount !== 1 ? 's' : ''} assigned to humans.</strong> The system will skip
                    these during automated implementation and any tasks that depend on them will also wait
                    until the manual work is completed.
                </div>
            )}
        </div>
    );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
    fontSize: 13,
    fontFamily: tokens.font.body,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
    marginBottom: 12,
    display: 'block',
};

const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: tokens.color.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    display: 'block', marginBottom: 4,
};

const ghostBtn: React.CSSProperties = {
    background: 'transparent',
    border: `1px solid ${tokens.color.border}`,
    color: tokens.color.text,
    cursor: 'pointer',
    borderRadius: tokens.radius.sm,
    padding: '6px 14px',
    fontSize: 13, fontWeight: 500,
};

const primaryBtn: React.CSSProperties = {
    background: tokens.color.primary,
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    borderRadius: tokens.radius.sm,
    padding: '7px 16px',
    fontSize: 13, fontWeight: 600,
};
