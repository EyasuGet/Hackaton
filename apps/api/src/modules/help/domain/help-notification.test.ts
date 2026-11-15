import { describe, expect, it } from 'vitest';
import {
  buildGenericSupportReplyNotice,
  helpReplyContentRef,
  helpReplyDedupKey,
  parseHelpReplyContentRef,
} from './help-notification.ts';

describe('help-notification domain', () => {
  it('builds generic notice containing return path and no sensitive content', () => {
    const returnUrl = 'http://localhost:5173/#inbox';
    const notice = buildGenericSupportReplyNotice(returnUrl);

    // Must contain generic information and the authorized return path
    expect(notice).toContain('Support Reply Notification');
    expect(notice).toContain('A support team member has replied to your help request');
    expect(notice).toContain(returnUrl);

    // Must not expose internal tokens, sensitive details, or arbitrary message bodies
    expect(notice).not.toContain('accommodation');
    expect(notice).not.toContain('confidential');
    expect(notice).not.toContain('password');
  });

  it('generates deterministic dedup keys and content references', () => {
    const helpRequestId = '11111111-2222-3333-4444-555555555555';
    const replyId = '66666666-7777-8888-9999-000000000000';

    const dedupKey = helpReplyDedupKey(helpRequestId, replyId);
    expect(dedupKey).toBe(`help-reply:${helpRequestId}:${replyId}`);

    const contentRef = helpReplyContentRef(helpRequestId, replyId);
    expect(contentRef).toBe(`help_reply:${helpRequestId}:${replyId}`);

    const parsed = parseHelpReplyContentRef(contentRef);
    expect(parsed).toEqual({ helpRequestId, replyId });
  });

  it('returns null when parsing invalid content references', () => {
    expect(parseHelpReplyContentRef('invalid:ref')).toBeNull();
    expect(parseHelpReplyContentRef('job:123:456')).toBeNull();
    expect(parseHelpReplyContentRef('help_reply:invalid-uuid:invalid-uuid')).toBeNull();
  });
});
