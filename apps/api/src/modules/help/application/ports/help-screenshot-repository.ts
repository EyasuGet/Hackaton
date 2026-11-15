// Storage port for the one screenshot a learner may attach to their own help request.
// Every operation carries the caller's access rule, so another principal's screenshot
// is never touched or returned; an expired request has no screenshot.
import type { ScreenshotImage } from '../help-screenshots.ts';

export interface HelpScreenshotRepository {
  /** Stores or replaces it on the owner's unexpired waiting or claimed request; false if none. */
  attach(ownerId: string, helpRequestId: string, image: ScreenshotImage): Promise<boolean>;
  /** Deletes it from the owner's request; false if there was none. */
  remove(ownerId: string, helpRequestId: string): Promise<boolean>;
  findForOwner(ownerId: string, helpRequestId: string): Promise<ScreenshotImage | null>;
  /** Only for the support principal who claimed the request and while it stays claimed. */
  findForClaimant(staffId: string, helpRequestId: string): Promise<ScreenshotImage | null>;
}
