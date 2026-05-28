import React from 'react';
import { I } from '../icons';

interface StubScreenProps {
  title: string;
  icon: string;
  description: string;
}

export const StubScreen: React.FC<StubScreenProps> = ({ title, icon, description }) => {
  const IconEl = I[icon] || I.Sparkles;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">{title}</h1>
          <p className="page-header__subtitle">{description}</p>
        </div>
      </div>
      <div className="card">
        <div className="card__bd" style={{padding: '48px 24px', textAlign: 'center'}}>
          <div style={{
            width: 64, height: 64, margin: '0 auto 14px',
            borderRadius: 14, background: 'var(--primary-50)',
            display: 'grid', placeItems: 'center', color: 'var(--primary)',
          }}>
            <IconEl size={28}/>
          </div>
          <h3 style={{margin: '0 0 6px', fontSize: 16, color: 'var(--text)'}}>
            {title} workspace
          </h3>
          <p style={{color: 'var(--text-3)', fontSize: 13, maxWidth: 420, margin: '0 auto'}}>
            This area surfaces {title.toLowerCase()} produced by SDLC pipelines, grouped by repo and request.
          </p>
          <div className="row" style={{justifyContent: 'center', marginTop: 18, gap: 8}}>
            <button className="btn"><I.Pipeline size={14}/> See related pipelines</button>
            <button className="btn btn--primary"><I.Plus size={14}/> Start new run</button>
          </div>
        </div>
      </div>
    </div>
  );
};
