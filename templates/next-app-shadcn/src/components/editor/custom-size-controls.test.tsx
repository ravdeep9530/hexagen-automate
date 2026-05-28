// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CustomSizeControls, validateCustomPresetField } from './custom-size-controls';
import { useEditorStore } from '../../store/editor-store';
import type { CustomPresetValues } from '../../types/editor';

const setCustomPreset = (values: CustomPresetValues) => {
  useEditorStore.getState().setCustomPreset(values);
};

describe('custom size controls', () => {
  beforeEach(() => {
    setCustomPreset({ widthMm: 35, heightMm: 45, dpi: 300 });
  });

  it('renders width, height, and DPI inputs with synced state values', () => {
    render(<CustomSizeControls />);

    expect(screen.getByLabelText('Width')).toHaveValue(35);
    expect(screen.getByLabelText('Height')).toHaveValue(45);
    expect(screen.getByLabelText('DPI')).toHaveValue(300);
  });

  it('updates the store when valid values are entered', async () => {
    render(<CustomSizeControls />);

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('DPI'), { target: { value: '600' } });

    await waitFor(() => {
      expect(useEditorStore.getState().customPreset).toMatchObject({
        widthMm: 40,
        heightMm: 50,
        dpi: 600,
      });
    });
  });

  it('rejects invalid values and does not update the store', async () => {
    render(<CustomSizeControls />);

    fireEvent.change(screen.getByLabelText('DPI'), { target: { value: '-100' } });

    await waitFor(() => {
      expect(useEditorStore.getState().customPreset.dpi).toBe(300);
    });
  });

  it('displays accessible validation text when values are out of range', () => {
    render(<CustomSizeControls />);

    fireEvent.change(screen.getByLabelText('DPI'), { target: { value: '2000' } });

    expect(screen.getByRole('status')).toHaveTextContent('DPI must be between 72 and 1200.');
  });

  it('marks inputs as invalid with aria-invalid when out of range', () => {
    render(<CustomSizeControls />);

    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '999' } });

    expect(screen.getByLabelText('Height')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('validateCustomPresetField', () => {
  it('returns null for values within the allowed range', () => {
    expect(validateCustomPresetField('Width', 35, 10, 200)).toBeNull();
    expect(validateCustomPresetField('DPI', 300, 72, 1200)).toBeNull();
  });

  it('returns an error message for values outside the range', () => {
    expect(validateCustomPresetField('Width', 5, 10, 200)).toBe('Width must be between 10 and 200.');
    expect(validateCustomPresetField('DPI', 1300, 72, 1200)).toBe('DPI must be between 72 and 1200.');
  });

  it('returns an error for non-finite values', () => {
    expect(validateCustomPresetField('Height', Infinity, 10, 200)).toBe('Height is required.');
    expect(validateCustomPresetField('Height', null as unknown as number, 10, 200)).toBe('Height is required.');
  });
});
