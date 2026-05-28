/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DimensionSummary } from './dimension-summary';
import { useEditorStore } from '../../store/editor-store';

vi.mock('../../store/editor-store', () => ({
  useEditorStore: vi.fn(),
}));

describe('DimensionSummary', () => {
  const mockStore = {
    selectedPresetId: 'us-passport',
    customPreset: { widthMm: 35, heightMm: 45, dpi: 300 },
    exportConfig: { dpi: 300 },
  };

  beforeEach(() => {
    vi.mocked(useEditorStore).mockImplementation((selector) => selector(mockStore as any));
  });

  it('renders with preset dimensions', () => {
    render(<DimensionSummary />);
    expect(screen.getByRole('heading', { name: /output dimensions/i })).toBeInTheDocument();
    expect(screen.getByText(/300 DPI/i)).toBeInTheDocument();
    expect(screen.getByText(/pixels/i)).toBeInTheDocument();
  });

  it('renders compact variant', () => {
    render(<DimensionSummary compact />);
    expect(screen.getByTestId('dimension-summary-compact')).toHaveTextContent(/mm/);
    expect(screen.getByTestId('dimension-summary-compact')).toHaveTextContent(/in/);
    expect(screen.getByTestId('dimension-summary-compact')).toHaveTextContent(/px/);
    expect(screen.getByTestId('dimension-summary-compact')).toHaveTextContent(/DPI/);
  });

  it('displays mm, inches, pixels, DPI sections', () => {
    render(<DimensionSummary />);
    expect(screen.getByText(/millimeters/i)).toBeInTheDocument();
    expect(screen.getByText(/inches/i)).toBeInTheDocument();
    expect(screen.getByText(/pixels/i)).toBeInTheDocument();
    expect(screen.getByText(/aspect/i)).toBeInTheDocument();
  });

  it('uses custom preset from store when selected', () => {
    vi.mocked(useEditorStore).mockImplementation((selector) =>
      selector({
        selectedPresetId: 'custom-size',
        customPreset: { widthMm: 40, heightMm: 60, dpi: 300 },
        exportConfig: { dpi: 300 },
      } as any),
    );

    render(<DimensionSummary />);
    expect(screen.getByText(/472 × 709 px/i)).toBeInTheDocument();
  });

  it('uses provided preset prop over store', () => {
    render(<DimensionSummary preset={{ widthMm: 25, heightMm: 35, dpi: 300 }} />);
    expect(screen.getByText(/295 × 413 px/i)).toBeInTheDocument();
  });
});
