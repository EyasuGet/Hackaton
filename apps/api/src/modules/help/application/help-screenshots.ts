// A screenshot the learner chooses to attach to their help request (T3-048), so a
// phone user without screen sharing can show support what they see. Only the owner
// may attach or remove it; only the owner and the claiming support person may view it.
import type { Principal } from '../../identity/domain/principal.ts';
import type { HelpScreenshotRepository } from './ports/help-screenshot-repository.ts';

export const SCREENSHOT_MAX_BYTES = 1024 * 1024;

export type ScreenshotMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ScreenshotImage {
  readonly mimeType: ScreenshotMimeType;
  readonly data: Buffer;
}

// The declared type must match the file's own signature, so nothing else is stored as an image.
const SIGNATURES: Record<ScreenshotMimeType, (data: Buffer) => boolean> = {
  'image/png': (d) =>
    d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (d) => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  'image/webp': (d) =>
    d.subarray(0, 4).toString('latin1') === 'RIFF' &&
    d.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function isScreenshotMimeType(value: string): value is ScreenshotMimeType {
  return Object.hasOwn(SIGNATURES, value);
}

export type AttachResult = 'attached' | 'invalid_image' | 'not_found';

export class HelpScreenshots {
  readonly #repository: HelpScreenshotRepository;

  constructor(repository: HelpScreenshotRepository) {
    this.#repository = repository;
  }

  async attach(
    principal: Principal,
    helpRequestId: string,
    image: ScreenshotImage,
  ): Promise<AttachResult> {
    if (principal.role !== 'learner') return 'not_found';
    const { data, mimeType } = image;
    if (data.length === 0 || data.length > SCREENSHOT_MAX_BYTES || !SIGNATURES[mimeType](data)) {
      return 'invalid_image';
    }
    const attached = await this.#repository.attach(principal.id, helpRequestId, image);
    return attached ? 'attached' : 'not_found';
  }

  async remove(principal: Principal, helpRequestId: string): Promise<boolean> {
    if (principal.role !== 'learner') return false;
    return this.#repository.remove(principal.id, helpRequestId);
  }

  async view(principal: Principal, helpRequestId: string): Promise<ScreenshotImage | null> {
    if (principal.role === 'learner') {
      return this.#repository.findForOwner(principal.id, helpRequestId);
    }
    if (principal.role === 'support') {
      return this.#repository.findForClaimant(principal.id, helpRequestId);
    }
    return null;
  }
}
