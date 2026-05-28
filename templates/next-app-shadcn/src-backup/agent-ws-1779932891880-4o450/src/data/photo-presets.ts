import type { CustomPresetValues, PhotoPreset, PhotoPresetCategory } from '../types/editor';

export const CUSTOM_PRESET_ID = 'custom-size';

export const PHOTO_PRESET_CATEGORIES: Array<{ id: PhotoPresetCategory; label: string }> = [
  { id: 'passport', label: 'Passport' },
  { id: 'visa', label: 'Visa' },
  { id: 'residency', label: 'Residency' },
  { id: 'license', label: 'License' },
  { id: 'custom', label: 'Custom' },
];

export const PHOTO_PRESETS: PhotoPreset[] = [
  {
    id: 'us-passport',
    label: 'United States passport',
    category: 'passport',
    country: 'United States',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.5, max: 0.69 },
    eyeLineRatio: 0.56,
    notes: [
      'Use a recent color photo taken in the last 6 months.',
      'Face the camera directly with a neutral expression and both eyes open.',
      'Do not wear glasses, uniforms, or head coverings unless allowed for medical or religious reasons.',
    ],
  },
  {
    id: 'canada-passport',
    label: 'Canada passport',
    category: 'passport',
    country: 'Canada',
    widthMm: 50,
    heightMm: 70,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.45, max: 0.53 },
    eyeLineRatio: 0.57,
    notes: [
      'Keep a plain white or light-colored background with no shadows.',
      'Ensure the head is centered and shoulders are visible.',
      'Confirm exact requirements with the latest Canadian passport instructions before submitting.',
    ],
  },
  {
    id: 'uk-passport',
    label: 'United Kingdom passport',
    category: 'passport',
    country: 'United Kingdom',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    background: 'light-gray',
    headHeightRatio: { min: 0.64, max: 0.8 },
    eyeLineRatio: 0.58,
    notes: [
      'Use a plain cream or light grey background.',
      'Keep your mouth closed and maintain a neutral expression.',
      'Avoid shadows on the face or behind the head.',
    ],
  },
  {
    id: 'india-passport',
    label: 'India passport',
    category: 'passport',
    country: 'India',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.5, max: 0.69 },
    eyeLineRatio: 0.56,
    notes: [
      'Use a frontal photo with full face, ears, neck, and shoulders visible.',
      'White or very light backgrounds are recommended.',
      'Check the current passport seva requirements for infants, uniforms, and head coverings.',
    ],
  },
  {
    id: 'schengen-visa',
    label: 'Schengen visa',
    category: 'visa',
    country: 'Schengen Area',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    background: 'light-gray',
    headHeightRatio: { min: 0.7, max: 0.8 },
    eyeLineRatio: 0.57,
    notes: [
      'Use a photo no older than 6 months.',
      'The face should occupy most of the frame with even lighting.',
      'Requirements can vary by consulate; verify before printing.',
    ],
  },
  {
    id: 'us-visa',
    label: 'United States visa',
    category: 'visa',
    country: 'United States',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.5, max: 0.69 },
    eyeLineRatio: 0.56,
    notes: [
      'Upload or print a square 2 x 2 inch image at high resolution.',
      'Use a plain white or off-white background.',
      'Digital retouching that changes appearance is not accepted.',
    ],
  },
  {
    id: 'china-visa',
    label: 'China visa',
    category: 'visa',
    country: 'China',
    widthMm: 33,
    heightMm: 48,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.62, max: 0.75 },
    eyeLineRatio: 0.57,
    notes: [
      'Use a full-face color photo with natural skin tones.',
      'White backgrounds are commonly required for application photos.',
      'Confirm the current embassy specification for online upload sizing.',
    ],
  },
  {
    id: 'canada-pr-card',
    label: 'Canada permanent resident card',
    category: 'residency',
    country: 'Canada',
    widthMm: 50,
    heightMm: 70,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.45, max: 0.53 },
    eyeLineRatio: 0.57,
    notes: [
      'Use a photo taken by a commercial photographer when required by IRCC.',
      'Keep the background plain white with uniform lighting.',
      'Print and back-of-photo rules may apply for mailed applications.',
    ],
  },
  {
    id: 'eu-residency',
    label: 'EU residency permit',
    category: 'residency',
    country: 'European Union',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    background: 'light-gray',
    headHeightRatio: { min: 0.7, max: 0.8 },
    eyeLineRatio: 0.57,
    notes: [
      'Most biometric residency photos use the same format as Schengen passport photos.',
      'Use a neutral expression and look straight at the camera.',
      'Local immigration offices may publish country-specific tolerances.',
    ],
  },
  {
    id: 'us-green-card',
    label: 'United States green card',
    category: 'residency',
    country: 'United States',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    background: 'white',
    headHeightRatio: { min: 0.5, max: 0.69 },
    eyeLineRatio: 0.56,
    notes: [
      'Use a photo matching U.S. visa/passport composition guidance.',
      'Avoid shadows, patterned backgrounds, and heavy image edits.',
      'Check the latest USCIS or Department of State photo examples.',
    ],
  },
  {
    id: 'us-driver-license',
    label: 'United States driver license',
    category: 'license',
    country: 'United States',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    background: 'off-white',
    headHeightRatio: { min: 0.5, max: 0.69 },
    eyeLineRatio: 0.56,
    notes: [
      'Many DMVs capture photos in person; use this only where self-supplied images are accepted.',
      'Choose a plain light background and clear frontal lighting.',
      'Verify state-specific license photo rules before submission.',
    ],
  },
  {
    id: 'uk-driving-license',
    label: 'UK driving licence',
    category: 'license',
    country: 'United Kingdom',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    background: 'light-gray',
    headHeightRatio: { min: 0.64, max: 0.8 },
    eyeLineRatio: 0.58,
    notes: [
      'Use a plain light grey or cream background.',
      'Keep your head uncovered unless worn for religious or medical reasons.',
      'DVLA digital applications can have separate upload checks.',
    ],
  },
  {
    id: CUSTOM_PRESET_ID,
    label: 'Custom size',
    category: 'custom',
    country: null,
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    background: 'custom',
    headHeightRatio: null,
    eyeLineRatio: null,
    notes: [
      'Enter the exact dimensions and DPI requested by your application authority.',
      'Custom output is a sizing tool only and does not guarantee official compliance.',
    ],
  },
];

export const getPresetById = (presetId: string): PhotoPreset | undefined =>
  PHOTO_PRESETS.find((preset) => preset.id === presetId);

export const getPresetsByCategory = (category: PhotoPresetCategory): PhotoPreset[] =>
  PHOTO_PRESETS.filter((preset) => preset.category === category);

export const getResolvedPreset = (
  presetId: string,
  customPreset: CustomPresetValues,
): PhotoPreset => {
  const preset = getPresetById(presetId) ?? getPresetById(CUSTOM_PRESET_ID) ?? PHOTO_PRESETS[0];

  if (preset.id !== CUSTOM_PRESET_ID) {
    return preset;
  }

  return {
    ...preset,
    widthMm: customPreset.widthMm,
    heightMm: customPreset.heightMm,
    dpi: customPreset.dpi,
  };
};
