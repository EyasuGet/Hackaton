// Domain models and rules for support reply notifications (T3-017-C).
// Notifications must be strictly generic: no sensitive message body, context snapshot,
// or accommodation details may ever be included in the notice text.

export interface HelpNotificationPreference {
  readonly learnerId: string;
  readonly channel: string;
  readonly optedIn: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const DEFAULT_RETURN_PATH = '/#inbox';

/**
 * Builds the generic notice text.
 * The notice never contains message bodies, accommodation details, or user data.
 * It provides only an authorized return path to view the reply securely.
 */
export function buildGenericSupportReplyNotice(returnUrl: string): string {
  const sanitizedUrl = returnUrl.trim();
  return [
    '🔔 Support Reply Notification',
    '',
    'A support team member has replied to your help request.',
    '',
    'For your privacy and security, message contents are never sent through Telegram.',
    `Please authenticate and view the reply in your help inbox: ${sanitizedUrl}`,
  ].join('\n');
}

/**
 * Generates the deduplication key for a support reply notification delivery intent.
 * Format: help-reply:<helpRequestId>:<replyId>
 */
export function helpReplyDedupKey(helpRequestId: string, replyId: string): string {
  return `help-reply:${helpRequestId}:${replyId}`;
}

/**
 * Generates the content_ref for a support reply notification delivery intent.
 */
export function helpReplyContentRef(helpRequestId: string, replyId: string): string {
  return `help_reply:${helpRequestId}:${replyId}`;
}

/**
 * Parses a help reply content reference back to its components.
 */
export function parseHelpReplyContentRef(
  contentRef: string,
): { helpRequestId: string; replyId: string } | null {
  const match = /^help_reply:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(contentRef);
  if (!match || !match[1] || !match[2]) return null;
  return { helpRequestId: match[1], replyId: match[2] };
}
