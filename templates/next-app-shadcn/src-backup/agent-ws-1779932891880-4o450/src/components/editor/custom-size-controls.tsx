'use client';

import { useEffect, useId, useState } from 'react';
import { useEditorStore } from '../../store/editor-store';

const MIN_MM = 10;
const MAX_MM = 200;
const MIN_DPI = 72;
const MAX_DPI = 1200;

type CustomField = 'widthMm' | 'heightMm' | 'dpi';
type DraftValues = Record<CustomField, string>;
type DraftErrors = Partial<Record<CustomField, string>>;

const FIELD_CONFIG: Array<{
  field: CustomField;
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  help: string;
}> = [
  {
    field: 'widthMm',
    label: 'Width',
    suffix: 'mm',
    min: MIN_MM,
    max: MAX_MM,
    step: 0.1,
    help: `Enter a width between ${MIN_MM} and ${MAX_MM} millimeters.`,
  },
  {
    field: 'heightMm',
    label: 'Height',
    suffix: 'mm',
    min: MIN_MM,
    max: MAX_MM,
    step: 0.1,
    help: `Enter a height between ${MIN_MM} and ${MAX_MM} millimeters.`,
  },
  {
    field: 'dpi',
    label: 'DPI',
    suffix: 'dpi',
    min: MIN_DPI,
    max: MAX_DPI,
    step: 1,
    help: `Enter a print resolution between ${MIN_DPI} and ${MAX_DPI} DPI.`,
  },
];

export const validateCustomPresetField = (
  label: string,
  value: number,
  min: number,
  max: number,
): string | null => {
  if (!Number.isFinite(value)) {
    return `${label} is required.`;
  }

  if (value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`;
  }

  return null;
};

const toDraftValues = (values: { widthMm: number; heightMm: number; dpi: number }): DraftValues => ({
  widthMm: String(values.widthMm),
  heightMm: String(values.heightMm),
  dpi: String(values.dpi),
});

export function CustomSizeControls(): JSX.Element {
  const customPreset = useEditorStore((state) => state.customPreset);
  const setCustomPreset = useEditorStore((state) => state.setCustomPreset);
  const [draftValues, setDraftValues] = useState<DraftValues>(() => toDraftValues(customPreset));
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const baseId = useId();

  useEffect(() => {
    setDraftValues((current) => {
      const next = toDraftValues(customPreset);

      return FIELD_CONFIG.reduce<DraftValues>((accumulator, { field }) => {
        accumulator[field] = draftErrors[field] ? current[field] : next[field];
        return accumulator;
      }, { ...next });
    });
  }, [customPreset, draftErrors]);

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-950">Custom size</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Set the physical output size requested by your application. Invalid values are not saved.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {FIELD_CONFIG.map(({ field, label, suffix, min, max, step, help }) => {
          const validationMessage = draftErrors[field] ?? null;
          const inputId = `${baseId}-${field}`;
          const helpId = `${inputId}-help`;
          const errorId = `${inputId}-error`;

          return (
            <div key={field} className="space-y-1.5">
              <label htmlFor={inputId} className="block text-xs font-medium text-slate-700">
                {label}
              </label>
              <div className="relative">
                <input
                  id={inputId}
                  type="number"
                  inputMode="decimal"
                  min={min}
                  max={max}
                  step={step}
                  value={draftValues[field]}
                  aria-invalid={validationMessage ? 'true' : 'false'}
                  aria-describedby={`${helpId}${validationMessage ? ` ${errorId}` : ''}`}
                  onChange={(event) => {
                    const rawValue = event.currentTarget.value;
                    const nextValue = Number(rawValue);
                    const nextError = validateCustomPresetField(label, nextValue, min, max);

                    setDraftValues((current) => ({ ...current, [field]: rawValue }));
                    setDraftErrors((current) => {
                      const next = { ...current };
                      if (nextError) {
                        next[field] = nextError;
                      } else {
                        delete next[field];
                      }
                      return next;
                    });

                    if (!nextError) {
                      setCustomPreset({ [field]: nextValue });
                    }
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-12 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-500">
                  {suffix}
                </span>
              </div>
              <p id={helpId} className="text-[11px] leading-4 text-slate-500">
                {help}
              </p>
              {validationMessage ? (
                <p id={errorId} role="status" className="text-[11px] font-medium leading-4 text-red-600">
                  {validationMessage}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
