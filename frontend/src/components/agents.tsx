import React from 'react';

interface AvatarProps { size: number; }

const AGENTS: Record<string, React.FC<AvatarProps>> = {
  requirements: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-req" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1"/><stop offset="1" stopColor="#4338ca"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-req)"/>
      <rect x="12" y="11" width="20" height="24" rx="2.5" fill="#ffffff"/>
      <rect x="18" y="8.5" width="8" height="5" rx="1.4" fill="#ffffff" stroke="#4338ca" strokeWidth="1.2"/>
      <line x1="16" y1="19" x2="28" y2="19" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round"/>
      <line x1="16" y1="24" x2="28" y2="24" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round"/>
      <line x1="16" y1="29" x2="23" y2="29" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="14.5" cy="19" r="1.1" fill="#4338ca"/>
      <circle cx="14.5" cy="24" r="1.1" fill="#4338ca"/>
    </svg>
  ),
  optimize: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-opt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#06b6d4"/><stop offset="1" stopColor="#0e7490"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-opt)"/>
      <path d="M11 28 A11 11 0 0 1 33 28" stroke="#ffffff" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
      <line x1="22" y1="28" x2="29" y2="17" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="22" cy="28" r="2.4" fill="#ffffff"/>
      <line x1="11.5" y1="26" x2="13.5" y2="25.5" stroke="#a5f3fc" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="32.5" y1="26" x2="30.5" y2="25.5" stroke="#a5f3fc" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="22" y1="14.5" x2="22" y2="16.5" stroke="#a5f3fc" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M33 11 l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 l2 -1 z" fill="#fef3c7"/>
    </svg>
  ),
  plan: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-plan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6"/><stop offset="1" stopColor="#6d28d9"/>
        </linearGradient>
        <marker id="arrow-plan" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
          <polygon points="0 0, 4 2, 0 4" fill="#6d28d9"/>
        </marker>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-plan)"/>
      <rect x="11" y="12" width="22" height="20" rx="2" fill="#ffffff"/>
      <line x1="11" y1="18" x2="33" y2="18" stroke="#ddd6fe" strokeWidth="1"/>
      <line x1="11" y1="24" x2="33" y2="24" stroke="#ddd6fe" strokeWidth="1"/>
      <line x1="18" y1="12" x2="18" y2="32" stroke="#ddd6fe" strokeWidth="1"/>
      <line x1="26" y1="12" x2="26" y2="32" stroke="#ddd6fe" strokeWidth="1"/>
      <rect x="13" y="14.5" width="4" height="3" rx="0.6" fill="#6d28d9"/>
      <rect x="22" y="20.5" width="4" height="3" rx="0.6" fill="#6d28d9"/>
      <rect x="28" y="27.5" width="4" height="3" rx="0.6" fill="#6d28d9"/>
      <path d="M17 16 L22 22 M26 22 L28 28" stroke="#6d28d9" strokeWidth="1.4" strokeLinecap="round" markerEnd="url(#arrow-plan)"/>
    </svg>
  ),
  design: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-design" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ec4899"/><stop offset="1" stopColor="#be185d"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-design)"/>
      <path d="M22 11 a11 11 0 1 0 0 22 c2 0 3 -1 3 -2.5 c0 -1 -1 -1.5 -1 -2.5 c0 -1.5 1.5 -2 3 -2 h2 a4 4 0 0 0 4 -4 C33 14 28 11 22 11 z" fill="#ffffff"/>
      <circle cx="16" cy="18" r="1.8" fill="#a855f7"/>
      <circle cx="22" cy="15.5" r="1.8" fill="#06b6d4"/>
      <circle cx="28" cy="18" r="1.8" fill="#f59e0b"/>
      <circle cx="15" cy="25" r="1.8" fill="#22c55e"/>
    </svg>
  ),
  sprint: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-sprint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f59e0b"/><stop offset="1" stopColor="#b45309"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-sprint)"/>
      <circle cx="22" cy="24" r="9" fill="#ffffff"/>
      <circle cx="22" cy="24" r="9" fill="none" stroke="#b45309" strokeWidth="1.4"/>
      <rect x="20" y="10.5" width="4" height="2.4" rx="0.6" fill="#ffffff"/>
      <line x1="22" y1="24" x2="22" y2="17.5" stroke="#b45309" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="22" y1="24" x2="27" y2="26" stroke="#b45309" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="22" cy="24" r="1.4" fill="#b45309"/>
      <line x1="32" y1="14" x2="35" y2="14" stroke="#fde68a" strokeWidth="1.6" strokeLinecap="round"/>
      <line x1="33" y1="18" x2="36" y2="18" stroke="#fde68a" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  implementation: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-impl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6"/><stop offset="1" stopColor="#1d4ed8"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-impl)"/>
      <rect x="9" y="13" width="26" height="18" rx="2.2" fill="#ffffff"/>
      <line x1="9" y1="17" x2="35" y2="17" stroke="#dbeafe" strokeWidth="1.2"/>
      <circle cx="12" cy="15" r="0.8" fill="#ef4444"/>
      <circle cx="14.5" cy="15" r="0.8" fill="#f59e0b"/>
      <circle cx="17" cy="15" r="0.8" fill="#22c55e"/>
      <path d="M13 22 L11 24 L13 26" stroke="#1d4ed8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M19 22 L21 24 L19 26" stroke="#1d4ed8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="translate(-2 0) scale(-1 1) translate(-40 0)"/>
      <line x1="24" y1="27.5" x2="32" y2="27.5" stroke="#1d4ed8" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  test: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-test" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981"/><stop offset="1" stopColor="#047857"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-test)"/>
      <path d="M18 10 h8 v8 l5 11 a2 2 0 0 1 -1.8 2.8 h-14.4 a2 2 0 0 1 -1.8 -2.8 l5 -11 z" fill="#ffffff"/>
      <line x1="18" y1="10" x2="26" y2="10" stroke="#047857" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M16 24 h12 l3.2 6.5 a1 1 0 0 1 -.9 1.5 h-16.6 a1 1 0 0 1 -.9 -1.5 z" fill="#a7f3d0"/>
      <circle cx="19" cy="29" r="1.3" fill="#ffffff"/>
      <circle cx="23.5" cy="27" r="0.9" fill="#ffffff"/>
      <circle cx="26" cy="30" r="1.1" fill="#ffffff"/>
      <circle cx="32" cy="14" r="4.5" fill="#22c55e" stroke="#ffffff" strokeWidth="1.4"/>
      <path d="M30 14 l1.5 1.5 l3 -3" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  ship: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ag-ship" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f172a"/><stop offset="1" stopColor="#334155"/>
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#ag-ship)"/>
      <path d="M22 10 l11 5.5 v13 l-11 5.5 l-11 -5.5 v-13 z" fill="#ffffff"/>
      <path d="M11 15.5 l11 5.5 l11 -5.5" stroke="#475569" strokeWidth="1.4" fill="none"/>
      <path d="M22 21 v13" stroke="#475569" strokeWidth="1.4"/>
      <circle cx="32" cy="32" r="6" fill="#22c55e" stroke="#ffffff" strokeWidth="1.6"/>
      <path d="M29.2 32 l2 2 l3.6 -3.8" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
};

interface AgentAvatarProps {
  kind: string;
  size?: number;
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({ kind, size = 44 }) => {
  const Comp = AGENTS[kind] || AGENTS.requirements;
  return <Comp size={size} />;
};
