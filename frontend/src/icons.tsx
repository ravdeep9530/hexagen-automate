import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

const Icon: React.FC<IconProps> = ({ size = 16, children, style, ...p }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    {...p}
  >
    {children}
  </svg>
);

export const I: Record<string, React.FC<IconProps>> = {
  Dashboard:    (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></Icon>,
  Pipeline:     (p) => <Icon {...p}><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><path d="M5 8v8M7 6h12M19 8a6 6 0 01-6 6H8"/></Icon>,
  Requirements: (p) => <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 14h6M9 18h4M9 10h2"/></Icon>,
  Sprint:       (p) => <Icon {...p}><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></Icon>,
  Test:         (p) => <Icon {...p}><path d="M9 2v6L4.5 18a2 2 0 001.7 3h11.6a2 2 0 001.7-3L15 8V2"/><path d="M9 2h6M7.5 14h9"/></Icon>,
  Mock:         (p) => <Icon {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 13h4M6 16h2"/></Icon>,
  Review:       (p) => <Icon {...p}><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></Icon>,
  Docs:         (p) => <Icon {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></Icon>,
  PR:           (p) => <Icon {...p}><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="6" r="2"/><path d="M6 8v8M18 8v4a3 3 0 01-3 3h-3M13 12l-2 3 2 3"/></Icon>,
  Plug:         (p) => <Icon {...p}><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 11-12 0z"/><path d="M12 18v4"/></Icon>,
  Settings:     (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></Icon>,
  Plus:         (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  Trash:        (p) => <Icon {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></Icon>,
  Refresh:      (p) => <Icon {...p}><path d="M3 12a9 9 0 0114.85-6.85L21 8M21 3v5h-5M21 12a9 9 0 01-14.85 6.85L3 16M3 21v-5h5"/></Icon>,
  Search:       (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></Icon>,
  Filter:       (p) => <Icon {...p}><path d="M3 4h18l-7 9v6l-4 2v-8z"/></Icon>,
  Repo:         (p) => <Icon {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z"/><path d="M8 8h6"/></Icon>,
  Branch:       (p) => <Icon {...p}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></Icon>,
  User:         (p) => <Icon {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></Icon>,
  Calendar:     (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Icon>,
  Clock:        (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>,
  Play:         (p) => <Icon {...p}><polygon points="5 3 19 12 5 21 5 3"/></Icon>,
  Stop:         (p) => <Icon {...p}><rect x="5" y="5" width="14" height="14" rx="1"/></Icon>,
  Pause:        (p) => <Icon {...p}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></Icon>,
  Check:        (p) => <Icon {...p}><polyline points="20 6 9 17 4 12"/></Icon>,
  CheckCircle:  (p) => <Icon {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></Icon>,
  X:            (p) => <Icon {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Icon>,
  XCircle:      (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></Icon>,
  Alert:        (p) => <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Icon>,
  Question:     (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></Icon>,
  External:     (p) => <Icon {...p}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></Icon>,
  Logs:         (p) => <Icon {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></Icon>,
  ChevronDown:  (p) => <Icon {...p}><polyline points="6 9 12 15 18 9"/></Icon>,
  ChevronRight: (p) => <Icon {...p}><polyline points="9 18 15 12 9 6"/></Icon>,
  ChevronLeft:  (p) => <Icon {...p}><polyline points="15 18 9 12 15 6"/></Icon>,
  ArrowRight:   (p) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Icon>,
  ArrowLeft:    (p) => <Icon {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></Icon>,
  Sparkles:     (p) => <Icon {...p}><path d="M12 3l1.9 5.7L19 10l-5.1 1.3L12 17l-1.9-5.7L5 10l5.1-1.3z"/><path d="M19 17v3M17.5 18.5h3"/></Icon>,
  Cog:          (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"/></Icon>,
  Layers:       (p) => <Icon {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></Icon>,
  Brush:        (p) => <Icon {...p}><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></Icon>,
  Box:          (p) => <Icon {...p}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></Icon>,
  Github:       (p) => <Icon {...p}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/></Icon>,
  Share:        (p) => <Icon {...p}><path d="M12 2l8 4v6c0 5-3.5 9.74-8 10-4.5-.26-8-5-8-10V6z"/></Icon>,
  Link:         (p) => <Icon {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></Icon>,
  Code:         (p) => <Icon {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></Icon>,
  Eye:          (p) => <Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Icon>,
  Database:     (p) => <Icon {...p}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></Icon>,
  GitGraph:     (p) => <Icon {...p}><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="5" cy="18" r="2"/><path d="M5 8v8M19 6v10a4 4 0 01-4 4H7"/></Icon>,
  Lightning:    (p) => <Icon {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Icon>,
  Bell:         (p) => <Icon {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Icon>,
  Folder:       (p) => <Icon {...p}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></Icon>,
  Cloud:        (p) => <Icon {...p}><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></Icon>,
  Upload:       (p) => <Icon {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></Icon>,
  Flag:         (p) => <Icon {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></Icon>,
  Tag:          (p) => <Icon {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></Icon>,
};
