export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const DEFAULT_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export interface ImageValidationOptions {
  maxSizeBytes?: number;
  createObjectUrl?: (file: File) => string;
  revokeObjectUrl?: (url: string) => void;
  imageFactory?: () => HTMLImageElement;
}

export interface ValidImageResult {
  valid: true;
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface InvalidImageResult {
  valid: false;
  error: string;
}

export type ImageValidationResult = ValidImageResult | InvalidImageResult;

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${Number.parseFloat((bytes / (1024 * 1024)).toFixed(1))} MB`;
  }

  if (bytes >= 1024) {
    return `${Number.parseFloat((bytes / 1024).toFixed(1))} KB`;
  }

  return `${bytes} bytes`;
};

const getCreateObjectUrl = (override?: (file: File) => string): ((file: File) => string) | null => {
  if (override) {
    return override;
  }

  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL.bind(URL);
  }

  return null;
};

const getRevokeObjectUrl = (override?: (url: string) => void): ((url: string) => void) => {
  if (override) {
    return override;
  }

  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    return URL.revokeObjectURL.bind(URL);
  }

  return () => undefined;
};

const createImageElement = (factory?: () => HTMLImageElement): HTMLImageElement | null => {
  if (factory) {
    return factory();
  }

  if (typeof Image !== 'undefined') {
    return new Image();
  }

  return null;
};

const decodeImageDimensions = (
  objectUrl: string,
  imageFactory?: () => HTMLImageElement,
): Promise<{ naturalWidth: number; naturalHeight: number }> =>
  new Promise((resolve, reject) => {
    const image = createImageElement(imageFactory);

    if (!image) {
      reject(new Error('Your browser could not decode this image. Please try a different JPG, PNG, or WEBP file.'));
      return;
    }

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      cleanup();

      if (naturalWidth > 0 && naturalHeight > 0) {
        resolve({ naturalWidth, naturalHeight });
      } else {
        reject(new Error('We could not read the image dimensions. Please choose another image.'));
      }
    };

    image.onerror = () => {
      cleanup();
      reject(new Error('We could not decode this image. Please choose a valid JPG, PNG, or WEBP file.'));
    };

    image.src = objectUrl;
  });

export const validateImageFile = async (
  file: File,
  options: ImageValidationOptions = {},
): Promise<ImageValidationResult> => {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_IMAGE_SIZE_BYTES;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType)) {
    return {
      valid: false,
      error: 'Please upload a JPG, PNG, or WEBP image file.',
    };
  }

  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `Please upload an image smaller than ${formatBytes(maxSizeBytes)}.`,
    };
  }

  const createObjectUrl = getCreateObjectUrl(options.createObjectUrl);

  if (!createObjectUrl) {
    return {
      valid: false,
      error: 'This browser does not support local image previews. Please try another browser.',
    };
  }

  const revokeObjectUrl = getRevokeObjectUrl(options.revokeObjectUrl);
  let objectUrl: string;

  try {
    objectUrl = createObjectUrl(file);
  } catch {
    return {
      valid: false,
      error: 'We could not prepare this image for preview. Please try another file.',
    };
  }

  try {
    const dimensions = await decodeImageDimensions(objectUrl, options.imageFactory);

    return {
      valid: true,
      file,
      objectUrl,
      naturalWidth: dimensions.naturalWidth,
      naturalHeight: dimensions.naturalHeight,
    };
  } catch (error) {
    revokeObjectUrl(objectUrl);

    return {
      valid: false,
      error: error instanceof Error ? error.message : 'We could not decode this image. Please choose another file.',
    };
  }
};
