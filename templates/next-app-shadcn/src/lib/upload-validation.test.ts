import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_MAX_IMAGE_SIZE_BYTES,
  type ImageValidationOptions,
  validateImageFile,
} from './upload-validation';

type MockImageElement = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
};

const createFile = (overrides: Partial<{ name: string; type: string; size: number }> = {}): File => {
  const defaults = {
    name: 'test.png',
    type: 'image/png',
    size: 1024 * 1024,
  };

  return {
    name: overrides.name ?? defaults.name,
    type: overrides.type ?? defaults.type,
    size: overrides.size ?? defaults.size,
    lastModified: Date.now(),
  } as File;
};

const createSuccessfulImageFactory = (width: number, height: number): (() => HTMLImageElement) => {
  return () => {
    const image: MockImageElement = {
      onload: null,
      onerror: null,
      src: '',
      naturalWidth: width,
      naturalHeight: height,
    };

    setTimeout(() => {
      image.onload?.();
    }, 0);

    return image as unknown as HTMLImageElement;
  };
};

const createFailingImageFactory = (): (() => HTMLImageElement) => {
  return () => {
    const image: MockImageElement = {
      onload: null,
      onerror: null,
      src: '',
      naturalWidth: 0,
      naturalHeight: 0,
    };

    setTimeout(() => {
      image.onerror?.();
    }, 0);

    return image as unknown as HTMLImageElement;
  };
};

const createZeroDimensionImageFactory = (): (() => HTMLImageElement) => {
  return () => {
    const image: MockImageElement = {
      onload: null,
      onerror: null,
      src: '',
      naturalWidth: 0,
      naturalHeight: 0,
    };

    setTimeout(() => {
      image.onload?.();
    }, 0);

    return image as unknown as HTMLImageElement;
  };
};

describe('ALLOWED_IMAGE_TYPES', () => {
  it('accepts only image/jpeg, image/png, and image/webp', () => {
    expect(ALLOWED_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('validateImageFile', () => {
  let defaultOptions: ImageValidationOptions;
  let revokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    revokeMock = vi.fn();
    defaultOptions = {
      createObjectUrl: () => 'blob:mock-url',
      revokeObjectUrl: revokeMock,
      imageFactory: createSuccessfulImageFactory(1200, 1600),
    };
  });

  it.each([
    ['image/jpeg', 'photo.jpg'],
    ['image/png', 'photo.png'],
    ['image/webp', 'photo.webp'],
  ])('accepts %s files', async (type, name) => {
    const file = createFile({ type, name });
    const result = await validateImageFile(file, defaultOptions);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.file).toBe(file);
    }
  });

  it.each([
    ['image/gif', 'animation.gif'],
    ['application/pdf', 'document.pdf'],
    ['text/plain', 'notes.txt'],
  ])('rejects unsupported %s files with a readable error', async (type, name) => {
    const result = await validateImageFile(createFile({ type, name }), defaultOptions);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('JPG');
      expect(result.error).toContain('PNG');
      expect(result.error).toContain('WEBP');
    }
  });

  it('rejects files above the configured maximum size', async () => {
    const result = await validateImageFile(createFile({ size: 5 * 1024 * 1024 }), {
      ...defaultOptions,
      maxSizeBytes: 2 * 1024 * 1024,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('2 MB');
      expect(result.error).toContain('smaller');
    }
  });

  it('accepts files at the configured maximum size', async () => {
    const result = await validateImageFile(createFile({ size: 1024 * 1024 }), {
      ...defaultOptions,
      maxSizeBytes: 1024 * 1024,
    });

    expect(result.valid).toBe(true);
  });

  it('uses DEFAULT_MAX_IMAGE_SIZE_BYTES when no maxSizeBytes is provided', async () => {
    const result = await validateImageFile(createFile({ size: DEFAULT_MAX_IMAGE_SIZE_BYTES + 1 }), defaultOptions);

    expect(result.valid).toBe(false);
  });

  it('returns natural dimensions and an object URL for valid decoded images', async () => {
    const createUrlMock = vi.fn().mockReturnValue('blob:custom-url');
    const file = createFile({ type: 'image/jpeg' });
    const result = await validateImageFile(file, {
      ...defaultOptions,
      createObjectUrl: createUrlMock,
      imageFactory: createSuccessfulImageFactory(1920, 1080),
    });

    expect(createUrlMock).toHaveBeenCalledWith(file);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.objectUrl).toBe('blob:custom-url');
      expect(result.naturalWidth).toBe(1920);
      expect(result.naturalHeight).toBe(1080);
    }
  });

  it('returns an error and revokes the object URL when decode fails', async () => {
    const result = await validateImageFile(createFile(), {
      ...defaultOptions,
      imageFactory: createFailingImageFactory(),
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('decode');
    }
    expect(revokeMock).toHaveBeenCalledWith('blob:mock-url');
  });

  it('returns an error and revokes the object URL when dimensions cannot be read', async () => {
    const result = await validateImageFile(createFile(), {
      ...defaultOptions,
      imageFactory: createZeroDimensionImageFactory(),
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('dimensions');
    }
    expect(revokeMock).toHaveBeenCalledWith('blob:mock-url');
  });

  it('returns an error when object URL creation fails', async () => {
    const result = await validateImageFile(createFile(), {
      ...defaultOptions,
      createObjectUrl: () => {
        throw new Error('Storage error');
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('preview');
    }
  });
});
