// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportFormatControls } from './export-format-controls';

describe('ExportFormatControls', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders format radio buttons for PNG and JPEG', () => {
    render(
      <ExportFormatControls format="png" quality={0.92} onFormatChange={vi.fn()} onQualityChange={vi.fn()} />,
    );

    const radioGroup = screen.getByRole('radiogroup', { name: /export output format/i });
    expect(within(radioGroup).getByRole('radio', { name: /png/i })).toBeInTheDocument();
    expect(within(radioGroup).getByRole('radio', { name: /jpeg/i })).toBeInTheDocument();
  });

  it('checks the current format and calls onFormatChange', () => {
    const onFormatChange = vi.fn();
    render(
      <ExportFormatControls format="png" quality={0.92} onFormatChange={onFormatChange} onQualityChange={vi.fn()} />,
    );

    const radioGroup = screen.getByRole('radiogroup', { name: /export output format/i });
    expect(within(radioGroup).getByRole('radio', { name: /png/i })).toBeChecked();
    
    fireEvent.click(within(radioGroup).getByRole('radio', { name: /jpeg/i }));
    expect(onFormatChange).toHaveBeenCalledWith('jpeg');
  });

  it('shows JPEG quality control only when JPEG is selected', () => {
    const { rerender } = render(
      <ExportFormatControls format="png" quality={0.92} onFormatChange={vi.fn()} onQualityChange={vi.fn()} />,
    );

    expect(screen.queryByLabelText('JPEG quality')).not.toBeInTheDocument();

    rerender(
      <ExportFormatControls format="jpeg" quality={0.85} onFormatChange={vi.fn()} onQualityChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('JPEG quality')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('calls onQualityChange when adjusting JPEG quality', () => {
    const onQualityChange = vi.fn();
    render(
      <ExportFormatControls format="jpeg" quality={0.92} onFormatChange={vi.fn()} onQualityChange={onQualityChange} />,
    );

    const qualityInput = screen.getByLabelText('JPEG quality');
    fireEvent.change(qualityInput, { target: { value: '0.8' } });
    expect(onQualityChange).toHaveBeenCalledWith(0.8);
  });

  it('disables all controls when disabled', () => {
    render(
      <ExportFormatControls format="png" quality={0.92} disabled onFormatChange={vi.fn()} onQualityChange={vi.fn()} />,
    );

    const radioGroup = screen.getByRole('radiogroup', { name: /export output format/i });
    expect(within(radioGroup).getByRole('radio', { name: /png/i })).toBeDisabled();
    expect(within(radioGroup).getByRole('radio', { name: /jpeg/i })).toBeDisabled();
  });

  it('normalizes quality input above 100 to within range', () => {
    render(
      <ExportFormatControls format="jpeg" quality={120} onFormatChange={vi.fn()} onQualityChange={vi.fn()} />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
