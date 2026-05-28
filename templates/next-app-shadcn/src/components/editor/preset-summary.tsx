'use client';

import { CUSTOM_PRESET_ID, getResolvedPreset } from '../../data/photo-presets';
import { useEditorStore } from '../../store/editor-store';

const BACKGROUND_LABELS = {
  white: 'White',
  'off-white': 'Off-white',
  'light-gray': 'Light gray',
  custom: 'Custom / as required',
} as const;

const CATEGORY_LABELS = {
  passport: 'Passport',
  visa: 'Visa',
  residency: 'Residency',
  license: 'License',
  custom: 'Custom',
} as const;

export function PresetSummary(): JSX.Element {
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const customPreset = useEditorStore((state) => state.customPreset);
  const preset = getResolvedPreset(selectedPresetId, customPreset);
  const isCustom = preset.id === CUSTOM_PRESET_ID;

  return (
    <section aria-labelledby="preset-summary-title" className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="preset-summary-title" className="text-sm font-semibold text-slate-950">
            {preset.label}
          </h3>
          <p className="text-xs text-slate-600">
            {CATEGORY_LABELS[preset.category]}
            {preset.country ? ` · ${preset.country}` : ''}
          </p>
        </div>
        {isCustom ? (
          <span className="w-fit rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
            Editable
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Width</dt>
          <dd className="mt-1 font-semibold text-slate-950">{preset.widthMm} mm</dd>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Height</dt>
          <dd className="mt-1 font-semibold text-slate-950">{preset.heightMm} mm</dd>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">DPI</dt>
          <dd className="mt-1 font-semibold text-slate-950">{preset.dpi}</dd>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Background</dt>
          <dd className="mt-1 font-semibold text-slate-950">{BACKGROUND_LABELS[preset.background]}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <p className="font-semibold">Compliance reminders</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {preset.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
