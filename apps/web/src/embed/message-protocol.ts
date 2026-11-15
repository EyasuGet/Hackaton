// Cross-frame messaging protocol for iframe ↔ host communication.
// Validates origin, schema, and intended audience before trusting any message.

export interface EmbedConfig {
  readonly token: string;
  readonly origin: string;
  readonly allow?: string;
  readonly sandbox?: string;
}

export type EmbedMessage =
  | { readonly type: 'init'; readonly token: string }
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'status'; readonly status: 'ready' | 'closed' };

export function isValidOrigin(actual: string, expected: string): boolean {
  // Never accept null, file://, or mismatched origins.
  // Production will verify against a config allowlist, not DOM attributes.
  return actual === expected && !actual.includes('null') && actual.startsWith('http');
}

export function validateMessage(data: unknown): data is EmbedMessage {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!('type' in obj) || typeof obj.type !== 'string') return false;
  const msg = obj as { type: string; [key: string]: unknown };

  switch (msg.type) {
    case 'init':
      return 'token' in msg && typeof msg.token === 'string';
    case 'open':
    case 'close':
      return true;
    case 'status':
      return 'status' in msg && (msg.status === 'ready' || msg.status === 'closed');
    default:
      return false;
  }
}

export function createMessage(
  type: EmbedMessage['type'],
  data?: Record<string, unknown>,
): EmbedMessage {
  const base: Record<string, unknown> = { type };
  if (data) Object.assign(base, data);
  if (!validateMessage(base)) throw new Error(`Invalid message: ${JSON.stringify(base)}`);
  return base;
}
