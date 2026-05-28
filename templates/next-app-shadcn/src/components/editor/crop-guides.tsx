'use client';

import React from 'react';

interface CropGuidesProps {
  showGrid: boolean;
  showFaceGuide: boolean;
  headHeightRatio?: { min: number; max: number } | null;
  eyeLineRatio?: number | null;
  className?: string;
}

export function CropGuides({
  showGrid,
  showFaceGuide,
  headHeightRatio,
  eyeLineRatio,
  className = '',
}: CropGuidesProps): React.JSX.Element {
  const hasFaceGuide = showFaceGuide && Boolean(headHeightRatio || eyeLineRatio);
  const headHeight = headHeightRatio
    ? Math.max(0, Math.min(1, (headHeightRatio.min + headHeightRatio.max) / 2))
    : null;
  const headTop = headHeight === null ? null : Math.max(0.04, (1 - headHeight) / 2);
  const headBottom = headHeight === null ? null : Math.min(0.96, headTop + headHeight);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {showGrid ? (
        <div className="absolute inset-0" data-testid="crop-grid-overlay">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white/50 shadow-[0_0_1px_rgba(0,0,0,0.6)]" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white/50 shadow-[0_0_1px_rgba(0,0,0,0.6)]" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-white/50 shadow-[0_0_1px_rgba(0,0,0,0.6)]" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-white/50 shadow-[0_0_1px_rgba(0,0,0,0.6)]" />
        </div>
      ) : null}

      {hasFaceGuide ? (
        <div className="absolute inset-0" data-testid="face-guide-overlay">
          {headTop !== null && headBottom !== null ? (
            <>
              <div
                data-testid="head-top-guide"
                className="absolute left-0 right-0 border-b border-dashed border-yellow-300/90"
                style={{ top: `${headTop * 100}%` }}
              >
                <span className="absolute right-1 -translate-y-full rounded bg-slate-950/70 px-1 text-[10px] font-medium text-yellow-100">
                  Head top
                </span>
              </div>
              <div
                data-testid="chin-guide"
                className="absolute left-0 right-0 border-b border-dashed border-yellow-300/90"
                style={{ top: `${headBottom * 100}%` }}
              >
                <span className="absolute right-1 rounded bg-slate-950/70 px-1 text-[10px] font-medium text-yellow-100">
                  Chin
                </span>
              </div>
              <div
                data-testid="head-height-guide"
                className="absolute rounded-full border-2 border-yellow-300/70 bg-yellow-200/10"
                style={{
                  top: `${headTop * 100}%`,
                  height: `${(headBottom - headTop) * 100}%`,
                  left: '18%',
                  right: '18%',
                }}
              />
            </>
          ) : null}

          {typeof eyeLineRatio === 'number' ? (
            <div
              data-testid="eye-line-guide"
              className="absolute left-0 right-0 border-b-2 border-amber-400/90"
              style={{ top: `${Math.max(0, Math.min(1, eyeLineRatio)) * 100}%` }}
            >
              <span className="absolute left-1 -translate-y-1/2 rounded bg-slate-950/70 px-1 text-[10px] font-medium text-amber-100">
                Eye line
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
