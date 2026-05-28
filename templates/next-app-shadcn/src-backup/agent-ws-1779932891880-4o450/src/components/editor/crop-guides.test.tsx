// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CropGuides } from './crop-guides';

describe('CropGuides', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders grid when showGrid is true', () => {
    const { container } = render(<CropGuides showGrid showFaceGuide={false} />);
    expect(screen.getByTestId('crop-grid-overlay')).toBeInTheDocument();
  });

  it('does not render grid when showGrid is false', () => {
    render(<CropGuides showGrid={false} showFaceGuide={false} />);
    expect(screen.queryByTestId('crop-grid-overlay')).not.toBeInTheDocument();
  });

  it('renders face guide when showFaceGuide is true and ratios are provided', () => {
    render(
      <CropGuides
        showGrid={false}
        showFaceGuide
        headHeightRatio={{ min: 0.5, max: 0.7 }}
        eyeLineRatio={0.56}
      />,
    );
    expect(screen.getByTestId('face-guide-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('head-top-guide')).toBeInTheDocument();
    expect(screen.getByTestId('chin-guide')).toBeInTheDocument();
    expect(screen.getByTestId('eye-line-guide')).toBeInTheDocument();
    expect(screen.getByTestId('head-height-guide')).toBeInTheDocument();
  });

  it('renders only eye line guide when only eyeLineRatio is provided', () => {
    render(<CropGuides showGrid={false} showFaceGuide eyeLineRatio={0.56} />);
    expect(screen.getByTestId('face-guide-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('head-top-guide')).not.toBeInTheDocument();
    expect(screen.getByTestId('eye-line-guide')).toBeInTheDocument();
  });

  it('does not render face guide when showFaceGuide is false', () => {
    render(
      <CropGuides
        showGrid
        showFaceGuide={false}
        headHeightRatio={{ min: 0.5, max: 0.7 }}
        eyeLineRatio={0.56}
      />,
    );
    expect(screen.queryByTestId('face-guide-overlay')).not.toBeInTheDocument();
  });

  it('does not render face guide when neither headHeightRatio nor eyeLineRatio is provided', () => {
    render(<CropGuides showGrid={false} showFaceGuide />);
    expect(screen.queryByTestId('face-guide-overlay')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <CropGuides showGrid={false} showFaceGuide={false} className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
