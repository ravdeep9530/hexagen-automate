import React, { useState, useEffect, useMemo, useRef } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
    useIntegrations,
    useGlobalPRView,
    TrackedPR,
    PRReviewComment,
    ScheduledReview,
    GitHubRepo,
    SchedulerRun,
} from '../../api/agentApi';

dayjs.extend(relativeTime);

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';
type StatusFilter = 'all' | 'pending' | 'posted';
type TopTab = 'tracked' | 'saved' | 'recent' | 'schedule';

const LS_TAB = 'ghpr_tab';
const LS_CONN_FILTER = 'ghpr_conn_filter';
const LS_REPO_FILTER = 'ghpr_repo_filter';
const LS_SINCE_FILTER = 'ghpr_since_filter';
const LS_COLLAPSED_REPOS = 'ghpr_collapsed_repos';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function parseBody(body: string): { issue: string; suggestion: string } {
    const idx = body.search(/\n\nSuggestion:\s*/);
    if (idx === -1) return { issue: body.trim(), suggestion: '' };
    return {
        issue: body.slice(0, idx).trim(),
        suggestion: body.slice(idx).replace(/^\n\nSuggestion:\s*/i, '').trim(),
    };
}

function buildCodeUrl(pr: TrackedPR, filePath: string, lineNumber: number | null): string {
    const base = `https://github.com/${pr.repo_owner}/${pr.repo_name}`;
    if (lineNumber) return `${base}/blob/${pr.github_sha}/${filePath}#L${lineNumber}`;
    return `${base}/blob/${pr.github_sha}/${filePath}`;
}

function formatInterval(min: number): string {
    if (min < 60) return `${min} min`;
    if (min < 1440) return `${Math.round(min / 60)}h`;
    if (min < 10080) return `${Math.round(min / 1440)}d`;
    return `${Math.round(min / 10080)}w`;
}

// ===== Icons (inline SVG matching the design) =====
const Icon = {
    chev: <svg className="ghpr-i-sm chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>,
    search: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
    refresh: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>,
    repo: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>,
    starOutline: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 2 3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>,
    starSolid: <svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>,
    listIcon: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
    clock: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
    recent: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M2 12h2" /><path d="M20 12h2" /></svg>,
    sparkles: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 14 8l6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>,
    external: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>,
    copy: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
    branch: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3v12" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>,
    plus: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14" /><path d="M5 12h14" /></svg>,
    thumbsUp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 2 2.35l-1.46 6A2 2 0 0 1 18.4 20H7" /><path d="M3 10h4v12H3z" /></svg>,
    thumbsDown: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-2-2.35l1.46-6A2 2 0 0 1 5.6 4H17" /><path d="M21 14h-4V2h4z" /></svg>,
    bolt: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m13 2-3 7h6l-3 7" /></svg>,
    bulb: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c1 1 1.5 2 1.5 3.3h5c0-1.3.5-2.3 1.5-3.3A7 7 0 0 0 12 2z" /></svg>,
    warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 9v4" /><circle cx="12" cy="17" r="0.5" fill="currentColor" /><path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z" /></svg>,
    info: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><circle cx="12" cy="8" r="0.5" fill="currentColor" /></svg>,
    error: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10" /><path d="m9 9 6 6" /><path d="m15 9-6 6" /></svg>,
    trash: <svg className="ghpr-i-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" /></svg>,
    play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
};

const SevIcon: React.FC<{ severity: string }> = ({ severity }) => {
    if (severity === 'critical') return Icon.error;
    if (severity === 'warning') return Icon.warn;
    return Icon.info;
};

// Highlight diff line. The leading sign is preserved in the displayed text.
function diffClass(line: string): string {
    if (line.startsWith('// File:')) return 'filemark';
    if (line.startsWith('@@')) return 'hunk';
    if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
    if (line.startsWith('-') && !line.startsWith('---')) return 'del';
    return 'ctx';
}

// ===== Main component =====
export const GitHubPRReview: React.FC = () => {
    const { connections } = useIntegrations();
    const githubConnections = useMemo(
        () => connections.filter(c => c.type === 'github'),
        [connections]
    );

    const {
        allOpenPRs, schedules,
        fetchAllOpenPRs, syncAll, fetchReposForConnection,
        reviewPRByConnection, fetchCommentsForPR, publishPRComments,
        submitCommentFeedback,
        fetchSchedules, saveSchedule, deleteSchedule, toggleSavedGlobal,
        fetchSchedulerRuns,
    } = useGlobalPRView();

    const [activeTab, setActiveTab] = useState<TopTab>(
        () => (localStorage.getItem(LS_TAB) as TopTab) || 'tracked'
    );
    const [connFilter, setConnFilter] = useState<string>(() => localStorage.getItem(LS_CONN_FILTER) || '');
    const [repoFilter, setRepoFilter] = useState<string>(() => localStorage.getItem(LS_REPO_FILTER) || '');
    const [sinceFilter, setSinceFilter] = useState<Dayjs | null>(() => {
        const saved = localStorage.getItem(LS_SINCE_FILTER);
        return saved ? dayjs(saved) : null;
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(LS_COLLAPSED_REPOS) || '[]')); }
        catch { return new Set(); }
    });

    // All repos available across selected connections (used by the repo picker — independent of tracked PRs)
    const [allRepos, setAllRepos] = useState<Array<{ full_name: string; connection_id: string; connection_name?: string }>>([]);
    const [reposLoading, setReposLoading] = useState(false);
    const repoBtnRef = useRef<HTMLDivElement | null>(null);
    const [repoPickerOpen, setRepoPickerOpen] = useState(false);

    const toggleRepoCollapse = (repo: string) => {
        setCollapsedRepos(prev => {
            const next = new Set(prev);
            if (next.has(repo)) next.delete(repo); else next.add(repo);
            localStorage.setItem(LS_COLLAPSED_REPOS, JSON.stringify(Array.from(next)));
            return next;
        });
    };

    const [selectedPR, setSelectedPR] = useState<TrackedPR | null>(null);
    const [reviewComments, setReviewComments] = useState<PRReviewComment[]>([]);
    const [, setReviewResult] = useState<any>(null);
    const [reviewing, setReviewing] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [showDiff, setShowDiff] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);


    useEffect(() => { localStorage.setItem(LS_TAB, activeTab); }, [activeTab]);
    useEffect(() => { localStorage.setItem(LS_CONN_FILTER, connFilter); }, [connFilter]);
    useEffect(() => { localStorage.setItem(LS_REPO_FILTER, repoFilter); }, [repoFilter]);
    useEffect(() => {
        if (sinceFilter) localStorage.setItem(LS_SINCE_FILTER, sinceFilter.toISOString());
        else localStorage.removeItem(LS_SINCE_FILTER);
    }, [sinceFilter]);

    useEffect(() => {
        if (activeTab === 'tracked') fetchAllOpenPRs(false);
        if (activeTab === 'saved') fetchAllOpenPRs(true);
        if (activeTab === 'recent') fetchAllOpenPRs(false);
        if (activeTab === 'schedule') fetchSchedules();
    }, [activeTab, fetchAllOpenPRs, fetchSchedules]);

    // Load repos for the picker: from the selected connection, or aggregated across all.
    useEffect(() => {
        let cancelled = false;
        const connsToLoad = connFilter ? githubConnections.filter(c => c.id === connFilter) : githubConnections;
        if (connsToLoad.length === 0) { setAllRepos([]); return; }
        setReposLoading(true);
        Promise.all(connsToLoad.map(c =>
            fetchReposForConnection(c.id)
                .then(repos => repos.map(r => ({ full_name: r.full_name, connection_id: c.id, connection_name: c.name })))
                .catch(() => [])
        ))
            .then(results => {
                if (cancelled) return;
                const merged = ([] as Array<{ full_name: string; connection_id: string; connection_name?: string }>).concat(...results);
                // Deduplicate by full_name (keep first occurrence)
                const seen = new Set<string>();
                const unique = merged.filter(r => seen.has(r.full_name) ? false : (seen.add(r.full_name), true));
                unique.sort((a, b) => a.full_name.localeCompare(b.full_name));
                setAllRepos(unique);
            })
            .finally(() => { if (!cancelled) setReposLoading(false); });
        return () => { cancelled = true; };
    }, [connFilter, githubConnections, fetchReposForConnection]);

    useEffect(() => {
        if (!selectedPR) return;
        const fresh = allOpenPRs.find(p => p.id === selectedPR.id);
        if (fresh && fresh !== selectedPR) setSelectedPR(fresh);
    }, [allOpenPRs, selectedPR]);

    const availableRepos = useMemo(() => {
        const set = new Set<string>();
        for (const pr of allOpenPRs) {
            if (!connFilter || pr.connection_id === connFilter) {
                set.add(`${pr.repo_owner}/${pr.repo_name}`);
            }
        }
        return Array.from(set).sort();
    }, [allOpenPRs, connFilter]);

    const filteredPRs = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return allOpenPRs.filter(pr => {
            if (activeTab === 'saved' && !pr.saved_for_later) return false;
            if (connFilter && pr.connection_id !== connFilter) return false;
            if (repoFilter && `${pr.repo_owner}/${pr.repo_name}` !== repoFilter) return false;
            if (sinceFilter && pr.last_sync_at && dayjs(pr.last_sync_at).isBefore(sinceFilter)) return false;
            if (q) {
                const hay = `${pr.title} ${pr.author} ${pr.branch} ${pr.pr_number}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [allOpenPRs, activeTab, connFilter, repoFilter, sinceFilter, searchQuery]);

    const recentPRs = useMemo(() => {
        return [...filteredPRs].sort((a, b) => dayjs(b.created_at).valueOf() - dayjs(a.created_at).valueOf());
    }, [filteredPRs]);

    const handleSyncAll = async () => {
        setSyncing(true);
        setToast(null);
        try {
            const res = await syncAll();
            setToast({ ok: true, text: `Synced ${res.repoCount} repo${res.repoCount === 1 ? '' : 's'} · ${res.prCount} PR${res.prCount === 1 ? '' : 's'} refreshed` });
            setTimeout(() => setToast(null), 4000);
        } catch {
            setToast({ ok: false, text: 'Sync failed — check backend logs' });
        } finally {
            setSyncing(false);
        }
    };

    const handleSelectPR = async (pr: TrackedPR) => {
        if (selectedPR?.id === pr.id) return;
        setSelectedPR(pr);
        setReviewResult(null);
        setReviewComments([]);
        setSeverityFilter('all');
        setStatusFilter('all');
        setShowDiff(false);
        const comments = await fetchCommentsForPR(pr);
        setReviewComments(comments);
    };

    const handleReview = async (pr: TrackedPR) => {
        setSelectedPR(pr);
        setReviewResult(null);
        setReviewComments([]);
        setReviewing(true);
        try {
            const result = await reviewPRByConnection(pr);
            setReviewResult(result);
            const comments = await fetchCommentsForPR(pr);
            setReviewComments(comments);
            await fetchAllOpenPRs(activeTab === 'saved');
        } finally {
            setReviewing(false);
        }
    };

    const handlePublish = async () => {
        if (!selectedPR) return;
        setPublishing(true);
        try {
            await publishPRComments(selectedPR);
            const comments = await fetchCommentsForPR(selectedPR);
            setReviewComments(comments);
        } finally {
            setPublishing(false);
        }
    };

    const handleFeedback = async (commentId: string, feedback: 'accepted' | 'rejected' | null) => {
        setReviewComments(prev => prev.map(c => c.id === commentId ? { ...c, feedback } : c));
        try { await submitCommentFeedback(commentId, feedback); } catch { /* ignore */ }
    };

    const copy = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    };

    const filteredComments = reviewComments
        .filter(c => {
            const bySev = severityFilter === 'all' || c.severity === severityFilter;
            const byStat = statusFilter === 'all'
                || (statusFilter === 'pending' && !c.is_posted)
                || (statusFilter === 'posted' && c.is_posted);
            return bySev && byStat;
        })
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

    const pendingCount = reviewComments.filter(c => !c.is_posted).length;
    const sevCounts = {
        critical: reviewComments.filter(c => c.severity === 'critical').length,
        warning: reviewComments.filter(c => c.severity === 'warning').length,
        info: reviewComments.filter(c => c.severity === 'info').length,
    };

    const groupedPRs = useMemo(() => {
        const g: Record<string, { connection_name?: string; prs: TrackedPR[] }> = {};
        for (const pr of filteredPRs) {
            const key = `${pr.repo_owner}/${pr.repo_name}`;
            if (!g[key]) g[key] = { connection_name: pr.connection_name, prs: [] };
            g[key].prs.push(pr);
        }
        return g;
    }, [filteredPRs]);

    // Derive diff stats for the strip
    const diffStats = useMemo(() => {
        if (!selectedPR?.diff_patch) return null;
        const lines = selectedPR.diff_patch.split('\n');
        let add = 0, del = 0, files = 0;
        for (const l of lines) {
            if (l.startsWith('// File:')) files++;
            else if (l.startsWith('+') && !l.startsWith('+++')) add++;
            else if (l.startsWith('-') && !l.startsWith('---')) del++;
        }
        return { lines: lines.length, add, del, files };
    }, [selectedPR]);

    const sinceLabel = sinceFilter ? `Since ${sinceFilter.format('MMM D')}` : 'Anytime';
    const connectionLabel = connFilter ? githubConnections.find(c => c.id === connFilter)?.name || 'All' : 'All connections';
    const repoLabel = repoFilter || 'All repositories';

    if (githubConnections.length === 0) {
        return (
            <div className="ghpr">
                <div className="ghpr-empty">
                    <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-heading)' }}>No GitHub Connection</h2>
                    <p>Go to the Integrations tab to add a GitHub connection first.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="ghpr">
                {/* Page head */}
                <div className="ghpr-pagehead">
                    <div>
                        <span className="ghpr-agent-pill">{Icon.sparkles} PR Reviewer Agent</span>
                        <h1>GitHub PR Review</h1>
                        <div className="ghpr-sub">
                            Automated review across {Object.keys(groupedPRs).length || 0} {Object.keys(groupedPRs).length === 1 ? 'repository' : 'repositories'}
                        </div>
                    </div>
                </div>

                {toast && <div className={`ghpr-toast${toast.ok ? '' : ' err'}`}>{toast.text}</div>}

                {/* Filter bar */}
                <div className="ghpr-filters">
                    <div className="ghpr-field">
                        <label>Connection</label>
                        <div className="ghpr-ctrl">
                            {Icon.listIcon}
                            <select value={connFilter} onChange={e => { setConnFilter(e.target.value); setRepoFilter(''); }}>
                                <option value="">All connections</option>
                                {githubConnections.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            {Icon.chev}
                        </div>
                    </div>
                    <div className="ghpr-field" ref={repoBtnRef} style={{ position: 'relative' }}>
                        <label>Repository</label>
                        <div
                            className="ghpr-ctrl"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setRepoPickerOpen(v => !v)}
                        >
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: repoFilter ? 'var(--text-1)' : 'var(--text-3)' }}>
                                {repoLabel}
                            </span>
                            {repoFilter && (
                                <button
                                    onClick={e => { e.stopPropagation(); setRepoFilter(''); setRepoPickerOpen(false); }}
                                    style={{ padding: 0, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                                    title="Clear"
                                >×</button>
                            )}
                            {Icon.chev}
                        </div>
                        {repoPickerOpen && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4 }}>
                                <RepoPicker
                                    repos={allRepos}
                                    loading={reposLoading}
                                    selected={repoFilter}
                                    trackedRepos={availableRepos}
                                    onPick={(r) => { setRepoFilter(r); setRepoPickerOpen(false); }}
                                />
                            </div>
                        )}
                    </div>
                    <div className="ghpr-field">
                        <label>Updated since</label>
                        <div className="ghpr-ctrl" style={{ gap: 4 }}>
                            <input
                                type="date"
                                value={sinceFilter ? sinceFilter.format('YYYY-MM-DD') : ''}
                                onChange={e => setSinceFilter(e.target.value ? dayjs(e.target.value) : null)}
                                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--text-1)', cursor: 'pointer', flex: 1 }}
                            />
                            {sinceFilter && (
                                <button
                                    onClick={() => setSinceFilter(null)}
                                    style={{ padding: 0, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                                    title="Clear"
                                >×</button>
                            )}
                        </div>
                    </div>
                    <button className="ghpr-btn-ghost" onClick={handleSyncAll} disabled={syncing} title="Refresh">
                        {syncing ? <span className="ghpr-spinner dark" /> : Icon.refresh}
                        {syncing ? 'Syncing…' : 'Sync'}
                    </button>
                </div>

                {/* Tab pill group */}
                <div className="ghpr-tabs">
                    <button className={`ghpr-tab${activeTab === 'tracked' ? ' is-active' : ''}`} onClick={() => setActiveTab('tracked')}>
                        {Icon.listIcon} Tracked PRs <span className="n">{allOpenPRs.length}</span>
                    </button>
                    <button className={`ghpr-tab${activeTab === 'saved' ? ' is-active' : ''}`} onClick={() => setActiveTab('saved')}>
                        {Icon.starOutline} Saved
                    </button>
                    <button className={`ghpr-tab${activeTab === 'recent' ? ' is-active' : ''}`} onClick={() => setActiveTab('recent')}>
                        {Icon.recent} Recent
                    </button>
                    <button className={`ghpr-tab${activeTab === 'schedule' ? ' is-active' : ''}`} onClick={() => setActiveTab('schedule')}>
                        {Icon.clock} Schedule <span className="n">{schedules.length}</span>
                    </button>
                </div>

                {activeTab === 'schedule' ? (
                    <SchedulePanel
                        githubConnections={githubConnections}
                        schedules={schedules}
                        onSave={saveSchedule}
                        onDelete={deleteSchedule}
                        fetchReposForConnection={fetchReposForConnection}
                        fetchSchedulerRuns={fetchSchedulerRuns}
                    />
                ) : (
                    <div className="ghpr-grid">
                        {/* LEFT: list */}
                        <aside className="ghpr-list">
                            <div className="ghpr-list-search">
                                {Icon.search}
                                <input
                                    placeholder="Filter by title, author, branch…"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                                <span className="ghpr-kbd">⌘K</span>
                            </div>

                            {filteredPRs.length === 0 ? (
                                <div className="ghpr-empty">
                                    {activeTab === 'saved'
                                        ? <p>No saved PRs. Star a PR to save it for later.</p>
                                        : activeTab === 'recent'
                                            ? <p>No recent PRs found.</p>
                                            : (allOpenPRs.length === 0
                                                ? <p>No tracked PRs yet. Click <strong>Sync</strong> to pull the latest.</p>
                                                : <p>No PRs match the current filter.</p>)}
                                </div>
                            ) : activeTab === 'recent' ? (
                                <div className="ghpr-recent-list">
                                    {recentPRs.map(pr => (
                                        <PRRow
                                            key={pr.id}
                                            pr={pr}
                                            selected={selectedPR?.id === pr.id}
                                            onSelect={handleSelectPR}
                                            onToggleSave={toggleSavedGlobal}
                                            showCreated
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="ghpr-grouped-list">
                                    {Object.entries(groupedPRs).map(([repo, group]) => (
                                        <RepoGroup
                                            key={repo}
                                            repo={repo}
                                            connectionName={group.connection_name}
                                            prs={group.prs}
                                            selectedId={selectedPR?.id}
                                            collapsed={collapsedRepos.has(repo)}
                                            onToggleCollapse={() => toggleRepoCollapse(repo)}
                                            onSelect={handleSelectPR}
                                            onToggleSave={toggleSavedGlobal}
                                        />
                                    ))}
                                </div>
                            )}
                        </aside>

                        {/* RIGHT: detail */}
                        <section className="ghpr-detail">
                            {!selectedPR ? (
                                <div className="ghpr-empty">
                                    <p>Select a PR from the list to view its AI review.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="ghpr-detail-head">
                                        <div className="ghpr-detail-title-row">
                                            <div className="ghpr-detail-title">
                                                <div className="num">#{selectedPR.pr_number} · {selectedPR.repo_owner}/{selectedPR.repo_name}</div>
                                                <h2>{selectedPR.title}</h2>
                                                <div className="ghpr-detail-meta">
                                                    <span className="ghpr-status-chip">
                                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                                                        {selectedPR.state}
                                                    </span>
                                                    <span className="ghpr-branch-pill">
                                                        {Icon.branch} {selectedPR.branch} → {selectedPR.base_branch}
                                                    </span>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                                        <span className="avatar-xs" style={{
                                                            width: 18, height: 18, fontSize: 10, borderRadius: '50%',
                                                            background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)',
                                                            display: 'grid', placeItems: 'center', fontWeight: 600,
                                                        }}>{selectedPR.author.charAt(0).toUpperCase()}</span>
                                                        {selectedPR.author}
                                                    </span>
                                                    {selectedPR.created_at && (
                                                        <>
                                                            <span style={{ color: 'var(--color-neutral-400)' }}>·</span>
                                                            <span>opened {dayjs(selectedPR.created_at).fromNow()}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="ghpr-detail-actions">
                                                <a className="ghpr-btn-ghost" href={selectedPR.html_url} target="_blank" rel="noopener noreferrer">
                                                    {Icon.external} View on GitHub
                                                </a>
                                                <button
                                                    className={`ghpr-btn-ghost${selectedPR.saved_for_later ? ' is-on' : ''}`}
                                                    onClick={() => toggleSavedGlobal(selectedPR, !selectedPR.saved_for_later)}
                                                    title={selectedPR.saved_for_later ? 'Remove from Saved' : 'Save for later'}
                                                >
                                                    {selectedPR.saved_for_later ? Icon.starSolid : Icon.starOutline}
                                                    {selectedPR.saved_for_later ? 'Saved' : 'Save for later'}
                                                </button>
                                                <button
                                                    className="ghpr-btn-primary"
                                                    onClick={selectedPR.ai_review_status === 'completed' ? () => handleReview(selectedPR) : () => handleReview(selectedPR)}
                                                    disabled={reviewing}
                                                    title={selectedPR.ai_review_status === 'completed' ? 'Re-run AI review' : 'Run AI review'}
                                                >
                                                    {reviewing ? <span className="ghpr-spinner" /> : Icon.sparkles}
                                                    {reviewing ? 'Reviewing…' : (selectedPR.ai_review_status === 'completed' ? 'Re-review' : 'Run AI Review')}
                                                </button>
                                                {pendingCount > 0 && (
                                                    <button className="ghpr-btn-primary" onClick={handlePublish} disabled={publishing}>
                                                        {publishing ? <span className="ghpr-spinner" /> : Icon.plus}
                                                        Publish {pendingCount}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Diff strip */}
                                    {diffStats && (
                                        <div className="ghpr-diff-strip">
                                            <span className="label">Code diff</span>
                                            <span className="lines">{diffStats.lines} lines</span>
                                            <span style={{ color: 'var(--color-neutral-400)' }}>·</span>
                                            <span className="lines">
                                                <span className="plus">+{diffStats.add}</span> <span className="minus">−{diffStats.del}</span>
                                            </span>
                                            <span style={{ color: 'var(--color-neutral-400)' }}>·</span>
                                            <span className="lines">{diffStats.files} file{diffStats.files === 1 ? '' : 's'}</span>
                                            <button className="ghpr-btn-ghost expand" onClick={() => setShowDiff(v => !v)}>
                                                {showDiff ? 'Collapse' : 'Expand'} {Icon.chev}
                                            </button>
                                        </div>
                                    )}
                                    {showDiff && selectedPR.diff_patch && (
                                        <pre className="ghpr-codeblock" style={{ margin: '12px 20px', maxHeight: 440, overflowY: 'auto' }}>
                                            {selectedPR.diff_patch.split('\n').map((line, i) => (
                                                <span key={i} className={diffClass(line)}>{line || ' '}</span>
                                            ))}
                                        </pre>
                                    )}

                                    {/* Filter pills */}
                                    {reviewComments.length > 0 && (
                                        <div className="ghpr-filter-pills">
                                            <button className={`ghpr-pill${severityFilter === 'all' ? ' is-active' : ''}`} onClick={() => setSeverityFilter('all')}>
                                                All <span className="n">{reviewComments.length}</span>
                                            </button>
                                            {sevCounts.critical > 0 && (
                                                <button className={`ghpr-pill${severityFilter === 'critical' ? ' is-active' : ''}`} onClick={() => setSeverityFilter(severityFilter === 'critical' ? 'all' : 'critical')}>
                                                    <span className="swatch error" /> Critical <span className="n">{sevCounts.critical}</span>
                                                </button>
                                            )}
                                            {sevCounts.warning > 0 && (
                                                <button className={`ghpr-pill${severityFilter === 'warning' ? ' is-active' : ''}`} onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')}>
                                                    <span className="swatch warn" /> Warning <span className="n">{sevCounts.warning}</span>
                                                </button>
                                            )}
                                            {sevCounts.info > 0 && (
                                                <button className={`ghpr-pill${severityFilter === 'info' ? ' is-active' : ''}`} onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')}>
                                                    <span className="swatch info" /> Info <span className="n">{sevCounts.info}</span>
                                                </button>
                                            )}
                                            <button className={`ghpr-pill${statusFilter === 'pending' ? ' is-active' : ''}`} onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}>
                                                <span className="swatch pending" /> Pending <span className="n">{pendingCount}</span>
                                            </button>
                                            <button className={`ghpr-pill${reviewComments.length - pendingCount === 0 ? ' is-dim' : ''}${statusFilter === 'posted' ? ' is-active' : ''}`} onClick={() => setStatusFilter(statusFilter === 'posted' ? 'all' : 'posted')}>
                                                Posted <span className="n">{reviewComments.length - pendingCount}</span>
                                            </button>
                                        </div>
                                    )}

                                    {/* Findings */}
                                    <div className="ghpr-findings">
                                        {filteredComments.length === 0 && !reviewing && (
                                            <div className="ghpr-empty" style={{ padding: '24px 0' }}>
                                                <p>No review comments yet. Click <strong>Run AI Review</strong> to analyze this PR.</p>
                                            </div>
                                        )}
                                        {reviewing && (
                                            <div className="ghpr-empty" style={{ padding: '24px 0' }}>
                                                <span className="ghpr-spinner dark" />
                                                <p style={{ marginTop: 8 }}>Analyzing diff and generating suggestions…</p>
                                            </div>
                                        )}
                                        {filteredComments.map(comment => (
                                            <FindingCard
                                                key={comment.id}
                                                comment={comment}
                                                pr={selectedPR}
                                                copiedId={copiedId}
                                                onCopy={() => copy(comment.id, comment.body)}
                                                onFeedback={handleFeedback}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </section>
                    </div>
                )}
        </div>
    );
};

// ===== Repo group =====
const RepoGroup: React.FC<{
    repo: string;
    connectionName?: string;
    prs: TrackedPR[];
    selectedId?: string;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onSelect: (pr: TrackedPR) => void;
    onToggleSave: (pr: TrackedPR, saved: boolean) => Promise<void>;
}> = ({ repo, connectionName, prs, selectedId, collapsed, onToggleCollapse, onSelect, onToggleSave }) => {
    const [owner, name] = repo.split('/');
    return (
        <div className="ghpr-repo-group">
            <button
                className={`ghpr-repo-head${collapsed ? ' is-collapsed' : ''}`}
                onClick={onToggleCollapse}
                aria-expanded={!collapsed}
            >
                <svg className="toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
                {Icon.repo}
                <span className="repo-org">{owner} /</span>
                <span className="repo-path">{name}</span>
                <span className="count-chip">{prs.length} open</span>
                {connectionName && <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>· {connectionName}</span>}
            </button>
            {!collapsed && prs.map(pr => (
                <PRRow key={pr.id} pr={pr} selected={selectedId === pr.id} onSelect={onSelect} onToggleSave={onToggleSave} />
            ))}
        </div>
    );
};

// ===== Custom repo picker =====
const RepoPicker: React.FC<{
    repos: Array<{ full_name: string; connection_id: string; connection_name?: string }>;
    loading: boolean;
    selected: string;
    trackedRepos: string[];
    onPick: (repo: string) => void;
}> = ({ repos, loading, selected, trackedRepos, onPick }) => {
    const [q, setQ] = useState('');
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return repos;
        return repos.filter(r => r.full_name.toLowerCase().includes(needle) || (r.connection_name || '').toLowerCase().includes(needle));
    }, [repos, q]);
    const trackedSet = useMemo(() => new Set(trackedRepos), [trackedRepos]);
    const ref = useRef<HTMLInputElement | null>(null);
    useEffect(() => { ref.current?.focus(); }, []);

    return (
        <div className="ghpr-picker">
            <div className="ghpr-picker-search">
                {Icon.search}
                <input
                    ref={ref}
                    placeholder="Search repositories…"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                />
            </div>
            <div className="ghpr-picker-list">
                <button
                    className={`ghpr-picker-item${selected === '' ? ' is-selected' : ''}`}
                    onClick={() => onPick('')}
                >
                    <span className={`check${selected !== '' ? ' invisible' : ''}`}>✓</span>
                    <span className="name" style={{ fontFamily: 'var(--font-body)' }}>All repositories</span>
                    <span className="meta">{repos.length}</span>
                </button>
                {loading && <div className="ghpr-picker-loading"><span className="ghpr-spinner dark" /> Loading repos…</div>}
                {!loading && filtered.length === 0 && (
                    <div className="ghpr-picker-empty">No repositories match “{q}”</div>
                )}
                {!loading && filtered.map(r => (
                    <button
                        key={`${r.connection_id}::${r.full_name}`}
                        className={`ghpr-picker-item${selected === r.full_name ? ' is-selected' : ''}`}
                        onClick={() => onPick(r.full_name)}
                    >
                        <span className={`check${selected !== r.full_name ? ' invisible' : ''}`}>✓</span>
                        <span className="name">{r.full_name}</span>
                        {trackedSet.has(r.full_name) && <span className="meta" style={{ color: 'var(--color-success)' }}>● tracked</span>}
                        {r.connection_name && <span className="meta">{r.connection_name}</span>}
                    </button>
                ))}
            </div>
        </div>
    );
};

const PRRow: React.FC<{
    pr: TrackedPR;
    selected: boolean;
    onSelect: (pr: TrackedPR) => void;
    onToggleSave: (pr: TrackedPR, saved: boolean) => Promise<void>;
    showCreated?: boolean;
}> = ({ pr, selected, onSelect, onToggleSave, showCreated }) => {
    const dotKind = pr.ai_review_status === 'completed' ? 'completed' : pr.ai_review_status === 'pending' ? 'pending' : 'idle';
    const lastSync = pr.last_sync_at ? dayjs(pr.last_sync_at) : null;
    const created = pr.created_at ? dayjs(pr.created_at) : null;

    return (
        <div className={`ghpr-pr${selected ? ' is-selected' : ''}`} onClick={() => onSelect(pr)}>
            <div className="ghpr-pr-status"><span className={`ghpr-dot ${dotKind}`} /></div>
            <div className="ghpr-pr-body">
                <div className="ghpr-pr-title" title={pr.title}>{pr.title}</div>
                <div className="ghpr-pr-meta">
                    <span className="num">#{pr.pr_number}</span>
                    <span className="dotsep">·</span>
                    <span className="author">
                        <span className="avatar-xs">{pr.author.charAt(0).toUpperCase()}</span>
                        {pr.author}
                    </span>
                    <span className="dotsep">·</span>
                    <span className="branch">{pr.branch} → {pr.base_branch}</span>
                    {showCreated && created && (
                        <>
                            <span className="dotsep">·</span>
                            <span className="created-badge" title={created.format('MMM D, YYYY [at] HH:mm')}>created {created.fromNow()}</span>
                        </>
                    )}
                    {!showCreated && lastSync && (
                        <>
                            <span className="dotsep">·</span>
                            <span title={lastSync.format('MMM D, YYYY [at] HH:mm')}>{lastSync.fromNow()}</span>
                        </>
                    )}
                </div>
            </div>
            <div className="ghpr-pr-right">
                <button
                    className={`ghpr-star${pr.saved_for_later ? ' is-on' : ''}`}
                    onClick={e => { e.stopPropagation(); onToggleSave(pr, !pr.saved_for_later); }}
                    title={pr.saved_for_later ? 'Remove from Saved' : 'Save for later'}
                >
                    {pr.saved_for_later ? Icon.starSolid : Icon.starOutline}
                </button>
            </div>
        </div>
    );
};

// ===== Finding card =====
const FindingCard: React.FC<{
    comment: PRReviewComment;
    pr: TrackedPR;
    copiedId: string | null;
    onCopy: () => void;
    onFeedback: (commentId: string, feedback: 'accepted' | 'rejected' | null) => void;
}> = ({ comment, pr, copiedId, onCopy, onFeedback }) => {
    const { issue, suggestion } = parseBody(comment.body);
    const codeUrl = comment.file_path ? buildCodeUrl(pr, comment.file_path, comment.line_number) : null;
    const sevClass = comment.severity === 'critical' ? 'error' : comment.severity === 'warning' ? 'warn' : 'info';
    const lineLabel = comment.start_line && comment.start_line !== comment.line_number
        ? `L ${comment.start_line}–${comment.line_number}`
        : comment.line_number ? `L ${comment.line_number}` : '';

    return (
        <article className="ghpr-finding">
            <header className="ghpr-finding-head">
                <span className={`ghpr-sev ${sevClass}`} title={comment.severity}>
                    <SevIcon severity={comment.severity} />
                </span>
                <span className="file">{comment.file_path || '—'}</span>
                {lineLabel && <span className="line">{lineLabel}</span>}
                {comment.replacement_code && (
                    <span className="patch-tag">{Icon.bolt} Patch</span>
                )}
                {comment.is_posted && <span className="posted-tag">✓ Posted</span>}
                <div className="head-actions">
                    {codeUrl && (
                        <a href={codeUrl} target="_blank" rel="noopener noreferrer" title="Open in GitHub" style={{ display: 'inline-grid', placeItems: 'center', width: 26, height: 26, borderRadius: 6, color: 'inherit' }}>
                            {Icon.external}
                        </a>
                    )}
                    <button onClick={onCopy} title="Copy">
                        {copiedId === comment.id ? '✓' : Icon.copy}
                    </button>
                </div>
            </header>
            <div className="ghpr-finding-body">
                <RenderWithCode text={issue} />
                {suggestion && (
                    <div className="ghpr-suggestion">
                        <div className="s-head">{Icon.bulb} Suggestion</div>
                        <div className="s-body"><RenderWithCode text={suggestion} /></div>
                    </div>
                )}
                {comment.replacement_code && (
                    <pre className="ghpr-codeblock">
                        {comment.replacement_code.split('\n').map((line, i) => (
                            <span key={i} className="add"><span className="ln">{i + 1}</span>+ {line}</span>
                        ))}
                    </pre>
                )}
                {comment.code_snippet && !comment.replacement_code && (
                    <pre className="ghpr-codeblock">
                        {comment.code_snippet.split('\n').map((line, i) => (
                            <span key={i} className={diffClass(line)}>{line || ' '}</span>
                        ))}
                    </pre>
                )}
            </div>
            <footer className="ghpr-finding-foot">
                <div className="ghpr-helpful">
                    Helpful?
                    <button
                        className={comment.feedback === 'accepted' ? 'is-on' : ''}
                        onClick={() => onFeedback(comment.id, comment.feedback === 'accepted' ? null : 'accepted')}
                        title="Yes"
                    >
                        {Icon.thumbsUp}
                    </button>
                    <button
                        className={comment.feedback === 'rejected' ? 'is-off' : ''}
                        onClick={() => onFeedback(comment.id, comment.feedback === 'rejected' ? null : 'rejected')}
                        title="No"
                    >
                        {Icon.thumbsDown}
                    </button>
                </div>
            </footer>
        </article>
    );
};

// Renders text and wraps `back-ticked` substrings in <code>
const RenderWithCode: React.FC<{ text: string }> = ({ text }) => {
    const parts: React.ReactNode[] = [];
    const re = /`([^`]+)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push(text.slice(last, m.index));
        parts.push(<code key={k++}>{m[1]}</code>);
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
};

// ===== Schedule panel =====
const SchedulePanel: React.FC<{
    githubConnections: Array<{ id: string; name: string }>;
    schedules: ScheduledReview[];
    onSave: (input: { connectionId: string; repoOwner?: string; repoName?: string; intervalMinutes: number; enabled: boolean; scope?: string; repos?: Array<{ owner: string; name: string }> }) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    fetchReposForConnection: (connectionId: string) => Promise<GitHubRepo[]>;
    fetchSchedulerRuns: (scheduleId?: string, limit?: number) => Promise<SchedulerRun[]>;
}> = ({ githubConnections, schedules, onSave, onDelete, fetchReposForConnection, fetchSchedulerRuns }) => {
    const [connId, setConnId] = useState('');
    const [scope, setScope] = useState<'connection' | 'repos'>('repos');
    const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
    const [intervalMin, setIntervalMin] = useState(360);
    const [saving, setSaving] = useState(false);
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [loadingRepos, setLoadingRepos] = useState(false);
    const [repoSearch, setRepoSearch] = useState('');
    const [runs, setRuns] = useState<SchedulerRun[]>([]);
    const [runsLoading, setRunsLoading] = useState(false);

    useEffect(() => {
        setRunsLoading(true);
        fetchSchedulerRuns(undefined, 50)
            .then(setRuns)
            .finally(() => setRunsLoading(false));
    }, [schedules, fetchSchedulerRuns]);

    useEffect(() => {
        if (!connId) { setRepos([]); setSelectedRepos(new Set()); return; }
        setLoadingRepos(true);
        fetchReposForConnection(connId).then(setRepos).finally(() => setLoadingRepos(false));
    }, [connId, fetchReposForConnection]);

    const toggleRepo = (fullName: string) => {
        setSelectedRepos(prev => {
            const next = new Set(prev);
            if (next.has(fullName)) next.delete(fullName); else next.add(fullName);
            return next;
        });
    };

    const filteredRepos = useMemo(() => {
        const q = repoSearch.trim().toLowerCase();
        if (!q) return repos;
        return repos.filter(r => r.full_name.toLowerCase().includes(q));
    }, [repos, repoSearch]);

    const handleSubmit = async () => {
        if (!connId) return;
        const reposPayload = scope === 'repos'
            ? Array.from(selectedRepos).map(full => {
                const [owner, name] = full.split('/');
                return { owner, name };
            })
            : [];
        setSaving(true);
        try {
            await onSave({
                connectionId: connId,
                intervalMinutes: intervalMin,
                enabled: true,
                scope: scope === 'connection' ? 'connection' : 'repo',
                repos: reposPayload,
            });
            setSelectedRepos(new Set());
            setRepoSearch('');
        } finally { setSaving(false); }
    };

    return (
        <div>
            <div className="ghpr-sched-form">
                <h3>Schedule automatic review</h3>
                <p className="ghpr-sched-help">
                    The <strong>PR Reviewer Agent</strong> will sync the selected repos and run a review at the chosen interval.
                </p>
                <div className="ghpr-sched-row">
                    <div className="ghpr-field">
                        <label>Connection</label>
                        <div className="ghpr-ctrl">
                            <select value={connId} onChange={e => { setConnId(e.target.value); setSelectedRepos(new Set()); setRepoSearch(''); }}>
                                <option value="">Select…</option>
                                {githubConnections.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                            </select>
                            {Icon.chev}
                        </div>
                    </div>
                    <div className="ghpr-field">
                        <label>Scope</label>
                        <div className="ghpr-ctrl">
                            <select value={scope} onChange={e => setScope(e.target.value as any)}>
                                <option value="connection">All tracked repos</option>
                                <option value="repos">Selected repos</option>
                            </select>
                            {Icon.chev}
                        </div>
                    </div>
                    <div className="ghpr-field">
                        <label>Every</label>
                        <div className="ghpr-ctrl">
                            <select value={intervalMin} onChange={e => setIntervalMin(parseInt(e.target.value))}>
                                <option value={30}>30 min</option>
                                <option value={60}>1 hour</option>
                                <option value={180}>3 hours</option>
                                <option value={360}>6 hours</option>
                                <option value={720}>12 hours</option>
                                <option value={1440}>1 day</option>
                                <option value={10080}>1 week</option>
                            </select>
                            {Icon.chev}
                        </div>
                    </div>
                </div>

                {scope === 'repos' && (
                    <div className="ghpr-field" style={{ marginBottom: 12 }}>
                        <label>Repositories <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>({selectedRepos.size} selected)</span></label>
                        <div className="ghpr-repo-multiselect">
                            <div className="ghpr-picker-search" style={{ marginBottom: 6 }}>
                                {Icon.search}
                                <input
                                    placeholder="Search repositories…"
                                    value={repoSearch}
                                    onChange={e => setRepoSearch(e.target.value)}
                                />
                            </div>
                            <div className="ghpr-repo-multiselect-list">
                                {loadingRepos && <div className="ghpr-picker-loading"><span className="ghpr-spinner dark" /> Loading repos…</div>}
                                {!loadingRepos && filteredRepos.length === 0 && (
                                    <div className="ghpr-picker-empty">{!connId ? 'Pick a connection first' : 'No repositories match'}</div>
                                )}
                                {!loadingRepos && filteredRepos.map(r => {
                                    const checked = selectedRepos.has(r.full_name);
                                    return (
                                        <label key={r.id} className={`ghpr-repo-checkbox${checked ? ' is-checked' : ''}`}>
                                            <input type="checkbox" checked={checked} onChange={() => toggleRepo(r.full_name)} />
                                            <span className="check">{checked ? '✓' : ''}</span>
                                            <span className="name">{r.full_name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        className="ghpr-btn-primary"
                        onClick={handleSubmit}
                        disabled={saving || !connId || (scope === 'repos' && selectedRepos.size === 0)}
                    >
                        {saving ? <span className="ghpr-spinner" /> : Icon.plus}
                        {saving ? 'Saving…' : 'Add Schedule'}
                    </button>
                </div>
            </div>

            <div className="ghpr-sched-list">
                {schedules.length === 0 ? (
                    <div className="ghpr-empty"><p>No scheduled reviews yet.</p></div>
                ) : schedules.map(s => (
                    <div key={s.id} className="ghpr-sched-item">
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ghpr-sched-item-title">
                                {s.scope === 'connection'
                                    ? `🌐 ${s.connection_name} — all tracked repos`
                                    : s.repos && s.repos.length > 0
                                        ? `📦 ${s.repos.length} repo${s.repos.length === 1 ? '' : 's'}`
                                        : `📦 ${s.repo_owner}/${s.repo_name}`}
                            </div>
                            {s.repos && s.repos.length > 0 && (
                                <div className="ghpr-sched-item-repos">
                                    {s.repos.map(r => `${r.owner}/${r.name}`).join(', ')}
                                </div>
                            )}
                            <div className="ghpr-sched-item-meta">
                                <span className="ghpr-agent-pill">{Icon.sparkles} {s.agent_name || 'PR Reviewer'}</span>
                                <span>Every {formatInterval(s.interval_minutes)}</span>
                                <span>Last: {s.last_run_at ? dayjs(s.last_run_at).fromNow() : 'never'}</span>
                                <span title={s.next_run_at ? dayjs(s.next_run_at).format('YYYY-MM-DD HH:mm') : ''}>
                                    Next: {s.next_run_at ? dayjs(s.next_run_at).fromNow() : '—'}
                                </span>
                            </div>
                        </div>
                        <span className="ghpr-status-chip" style={{
                            background: s.enabled ? 'var(--color-success-light)' : 'var(--color-neutral-100)',
                            color: s.enabled ? 'var(--color-success)' : 'var(--text-secondary)',
                        }}>
                            {s.enabled ? 'Active' : 'Paused'}
                        </span>
                        <button className="ghpr-btn-ghost" onClick={() => onDelete(s.id)} title="Delete">
                            {Icon.trash}
                        </button>
                    </div>
                ))}
            </div>

            <div className="ghpr-sched-activity">
                <h4>Scheduler activity</h4>
                {runsLoading ? (
                    <div className="ghpr-picker-loading"><span className="ghpr-spinner dark" /> Loading…</div>
                ) : runs.length === 0 ? (
                    <div className="ghpr-empty"><p>No scheduler activity yet.</p></div>
                ) : (
                    <div className="ghpr-sched-activity-list">
                        {runs.map(r => (
                            <div key={r.id} className={`ghpr-sched-activity-row${r.status === 'failed' ? ' is-failed' : ''}`}>
                                <span className="ghpr-sched-activity-badge" data-action={r.action}>
                                    {r.action}
                                </span>
                                <span className="ghpr-sched-activity-repo">
                                    {r.repo_owner && r.repo_name ? `${r.repo_owner}/${r.repo_name}` : '—'}
                                    {r.pr_number ? ` #${r.pr_number}` : ''}
                                </span>
                                <span className="ghpr-sched-activity-msg" title={r.message || ''}>
                                    {r.message || (r.status === 'success' ? 'OK' : 'Failed')}
                                </span>
                                <span className="ghpr-sched-activity-time">
                                    {dayjs(r.created_at).fromNow()}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
