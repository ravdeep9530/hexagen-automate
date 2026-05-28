// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackgroundAdjustmentControls } from './background-adjustment-controls';
import { normalizeHexColor } from './color-field';
import { createDefaultEditorState, useEditorStore } from '../../store/editor-store';

describe('background adjustment controls', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...createDefaultEditorState() }, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('sets background mode to original, white, or solid', async () => {
    render(<BackgroundAdjustmentControls />);

    fireEvent.click(screen.getByRole('radio', { name: /Original/i }));
    await waitFor(() => expect(useEditorStore.getState().background.mode).toBe('original'));

    fireEvent.click(screen.getByRole('radio', { name: /Solid color/i }));
    await waitFor(() => expect(useEditorStore.getState().background.mode).toBe('solid'));

    fireEvent.click(screen.getByRole('radio', { name: /^White/i }));
    await waitFor(() => expect(useEditorStore.getState().background.mode).toBe('white'));
  });

  it('updates the solid background color and defaults to white', async () => {
    render(<BackgroundAdjustmentControls />);

    expect(useEditorStore.getState().background.color).toBe('#ffffff');

    fireEvent.click(screen.getByRole('radio', { name: /Solid color/i }));
    fireEvent.change(screen.getByLabelText(/Solid background color hex value/i), {
      target: { value: '#ffcc00' },
    });

    await waitFor(() => expect(useEditorStore.getState().background.color).toBe('#ffcc00'));
  });

  it('updates brightness and contrast values with accessible numeric output', async () => {
    render(<BackgroundAdjustmentControls />);

    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Contrast'), { target: { value: '-15' } });

    await waitFor(() => {
      expect(useEditorStore.getState().adjustments).toMatchObject({ brightness: 25, contrast: -15 });
    });

    expect(screen.getByLabelText('Brightness')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByLabelText('Contrast')).toHaveAttribute('aria-valuenow', '-15');
    expect(screen.getByText('-15%')).toBeInTheDocument();
  });

  it('states that background replacement is solid composition and not AI removal', () => {
    render(<BackgroundAdjustmentControls />);

    expect(screen.getByText(/solid composition only/i)).toBeInTheDocument();
    expect(screen.getByText(/does not perform AI background removal/i)).toBeInTheDocument();
  });

  it('resets background and adjustment controls to defaults', async () => {
    useEditorStore.getState().setBackgroundSettings({ mode: 'solid', color: '#123456' });
    useEditorStore.getState().setAdjustments({ brightness: 30, contrast: -20 });

    render(<BackgroundAdjustmentControls />);
    fireEvent.click(screen.getByRole('button', { name: /Reset controls/i }));

    await waitFor(() => {
      expect(useEditorStore.getState().background).toEqual({
        mode: 'white',
        color: '#ffffff',
        removeBackground: false,
      });
      expect(useEditorStore.getState().adjustments).toMatchObject({ brightness: 0, contrast: 0 });
    });
  });
});

describe('normalizeHexColor', () => {
  it('normalizes valid hex colors and falls back for invalid values', () => {
    expect(normalizeHexColor(' #ABCDEF ')).toBe('#abcdef');
    expect(normalizeHexColor('not-a-color', '#123456')).toBe('#123456');
  });
});
