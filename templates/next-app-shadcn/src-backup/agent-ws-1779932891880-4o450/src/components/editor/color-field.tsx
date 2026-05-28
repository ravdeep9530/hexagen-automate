'use client';

import React, { useId } from 'react';

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const normalizeHexColor = (value: string, fallback = '#ffffff'): string => {
  const trimmed = value.trim();

  if (HEX_COLOR_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return fallback;
};

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  disabled?: boolean;
}

export function ColorField({
  label,
  value,
  onChange,
  description = 'Choose a six digit hex color for the solid composition background.',
  disabled = false,
}: ColorFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = `${generatedId}-color`;
  const textId = `${generatedId}-hex`;
  const descriptionId = `${generatedId}-description`;
  const normalizedValue = normalizeHexColor(value);

  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-xs font-medium text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={fieldId}
          type="color"
          value={normalizedValue}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(normalizeHexColor(event.currentTarget.value, normalizedValue))}
          className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 bg-white p-1 outline-none transition focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          id={textId}
          type="text"
          inputMode="text"
          value={normalizedValue}
          disabled={disabled}
          aria-label={`${label} hex value`}
          aria-describedby={descriptionId}
          pattern="#[0-9a-fA-F]{6}"
          onChange={(event) => onChange(normalizeHexColor(event.currentTarget.value, normalizedValue))}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        />
      </div>
      <p id={descriptionId} className="text-[11px] leading-4 text-slate-500">
        {description}
      </p>
    </div>
  );
}
