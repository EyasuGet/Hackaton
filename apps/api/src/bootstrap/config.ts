// Validates the API's required runtime configuration once at startup.
// Error messages name the offending variable but never echo its value, so a
// misplaced secret cannot leak into logs.

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export interface RelayConfig {
  /** True when an approved TURN relay is configured for screen sharing. */
  readonly enabled: boolean;
  readonly url?: string;
  readonly realm?: string;
  readonly secret?: string;
}

export interface TelegramConfig {
  /** Secret token sent by Telegram in X-Telegram-Bot-Api-Secret-Token for webhook verification. */
  readonly webhookSecret?: string;
  /** Bot token used for verifying WebApp initData HMAC signatures. */
  readonly botToken?: string;
}

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly database: DatabaseConfig;
  /** Enables synthetic demo identities; never a form of real authentication. */
  readonly demoMode: boolean;
  /** Exact page origins allowed to start a demo session, for example `http://localhost:5173`. */
  readonly demoAllowedOrigins: readonly string[];
  /** Optional media relay configuration for WebRTC screen sharing across symmetric NAT. */
  readonly relay: RelayConfig;
  /** Optional Telegram bot/webhook configuration for channel adapter. */
  readonly telegram: TelegramConfig;
  /** Bounded provider admission and rate limits configuration (T3-024-C). */
  readonly providerLimits: ProviderLimitsConfig;
}

export interface ProviderLimitsConfig {
  /** Maximum concurrent provider operations in this API process across all learners. Default: 5. */
  readonly maxConcurrency: number;
  /** Maximum concurrent provider operations for a single learner (fairness guard). Default: 2. */
  readonly maxPerLearnerConcurrency: number;
  /** Maximum number of queued requests awaiting an execution slot before immediate rejection. Default: 10. */
  readonly maxQueueSize: number;
  /** Maximum pending requests in queue for a single learner. Default: 2. */
  readonly maxPerLearnerQueue: number;
  /** Maximum time (ms) a request may wait in queue before timing out. Default: 5000. */
  readonly queueTimeoutMs: number;
  /** Sliding window duration (ms) for rate limits. Default: 60000 (1 minute). */
  readonly rateLimitWindowMs: number;
  /** Maximum provider requests in window across all learners. Default: 60. */
  readonly rateLimitMaxRequests: number;
  /** Maximum provider requests in window for a single learner. Default: 10. */
  readonly rateLimitPerLearnerMaxRequests: number;
  /** Maximum character length for a question input. Default: 1000. */
  readonly maxQuestionLength: number;
  /** Maximum character length for speech text input. Default: 2000. */
  readonly maxSpeechTextLength: number;
}

export const DEFAULT_PROVIDER_LIMITS: ProviderLimitsConfig = {
  maxConcurrency: 5,
  maxPerLearnerConcurrency: 2,
  maxQueueSize: 10,
  maxPerLearnerQueue: 2,
  queueTimeoutMs: 5000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 60,
  rateLimitPerLearnerMaxRequests: 10,
  maxQuestionLength: 1000,
  maxSpeechTextLength: 2000,
};

type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

function untrimmed(env: Env, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new ConfigError(`${name} is required`);
  return value;
}

function port(env: Env, name: string): number {
  const raw = required(env, name);
  const value = Number(raw);
  // Reject "3000abc", decimals and out-of-range values rather than guessing.
  if (!/^\d+$/.test(raw) || value < 1 || value > 65535) {
    throw new ConfigError(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

export function loadDatabaseConfig(env: Env): DatabaseConfig {
  return {
    host: required(env, 'DATABASE_HOST'),
    port: port(env, 'DATABASE_PORT'),
    database: required(env, 'DATABASE_NAME'),
    user: required(env, 'DATABASE_USER'),
    // Not trimmed: Compose passes the password verbatim, so both sides must match exactly.
    password: untrimmed(env, 'DATABASE_PASSWORD'),
  };
}

/** Off unless explicitly `true`; any value other than `true`/`false` is a mistake worth stopping for. */
export function loadDemoMode(env: Env): boolean {
  const value = env.DEMO_MODE?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new ConfigError('DEMO_MODE must be true or false');
}

/**
 * Comma-separated exact http(s) origins; empty means no page may start a demo
 * session. `null` and file origins are never accepted.
 */
export function loadDemoAllowedOrigins(env: Env): string[] {
  const entries = (env.DEMO_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    let url: URL | undefined;
    try {
      url = new URL(entry);
    } catch {
      url = undefined;
    }
    const isOrigin =
      url && (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === entry;
    if (!isOrigin) {
      throw new ConfigError(
        'DEMO_ALLOWED_ORIGINS must list exact http(s) origins, comma-separated',
      );
    }
  }
  return entries;
}

export function loadRelayConfig(env: Env): RelayConfig {
  const flag = env.TURN_ENABLED?.trim();
  if (!flag || flag === 'false') return { enabled: false };
  if (flag !== 'true') throw new ConfigError('TURN_ENABLED must be true or false');

  const url = required(env, 'TURN_URL');
  if (!/^(stun|turn|turns):/i.test(url)) {
    throw new ConfigError('TURN_URL must start with stun:, turn:, or turns:');
  }

  return {
    enabled: true,
    url,
    realm: required(env, 'TURN_REALM'),
    secret: untrimmed(env, 'TURN_STATIC_AUTH_SECRET'),
  };
}

export function loadTelegramConfig(env: Env): TelegramConfig {
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
  return {
    ...(webhookSecret ? { webhookSecret } : {}),
    ...(botToken ? { botToken } : {}),
  };
}

export function loadProviderLimitsConfig(env: Env): ProviderLimitsConfig {
  function optionalPositiveInteger(name: string, defaultValue: number): number {
    const raw = env[name]?.trim();
    if (!raw) return defaultValue;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < 1) {
      throw new ConfigError(`${name} must be a positive integer`);
    }
    return value;
  }

  function optionalNonNegativeInteger(name: string, defaultValue: number): number {
    const raw = env[name]?.trim();
    if (!raw) return defaultValue;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < 0) {
      throw new ConfigError(`${name} must be a non-negative integer`);
    }
    return value;
  }

  return {
    maxConcurrency: optionalPositiveInteger(
      'PROVIDER_MAX_CONCURRENCY',
      DEFAULT_PROVIDER_LIMITS.maxConcurrency,
    ),
    maxPerLearnerConcurrency: optionalPositiveInteger(
      'PROVIDER_MAX_PER_LEARNER_CONCURRENCY',
      DEFAULT_PROVIDER_LIMITS.maxPerLearnerConcurrency,
    ),
    maxQueueSize: optionalNonNegativeInteger(
      'PROVIDER_MAX_QUEUE_SIZE',
      DEFAULT_PROVIDER_LIMITS.maxQueueSize,
    ),
    maxPerLearnerQueue: optionalPositiveInteger(
      'PROVIDER_MAX_PER_LEARNER_QUEUE',
      DEFAULT_PROVIDER_LIMITS.maxPerLearnerQueue,
    ),
    queueTimeoutMs: optionalPositiveInteger(
      'PROVIDER_QUEUE_TIMEOUT_MS',
      DEFAULT_PROVIDER_LIMITS.queueTimeoutMs,
    ),
    rateLimitWindowMs: optionalPositiveInteger(
      'PROVIDER_RATE_LIMIT_WINDOW_MS',
      DEFAULT_PROVIDER_LIMITS.rateLimitWindowMs,
    ),
    rateLimitMaxRequests: optionalPositiveInteger(
      'PROVIDER_RATE_LIMIT_MAX_REQUESTS',
      DEFAULT_PROVIDER_LIMITS.rateLimitMaxRequests,
    ),
    rateLimitPerLearnerMaxRequests: optionalPositiveInteger(
      'PROVIDER_RATE_LIMIT_PER_LEARNER_MAX_REQUESTS',
      DEFAULT_PROVIDER_LIMITS.rateLimitPerLearnerMaxRequests,
    ),
    maxQuestionLength: optionalPositiveInteger(
      'PROVIDER_MAX_QUESTION_LENGTH',
      DEFAULT_PROVIDER_LIMITS.maxQuestionLength,
    ),
    maxSpeechTextLength: optionalPositiveInteger(
      'PROVIDER_MAX_SPEECH_TEXT_LENGTH',
      DEFAULT_PROVIDER_LIMITS.maxSpeechTextLength,
    ),
  };
}

export function loadConfig(env: Env): ApiConfig {
  return {
    host: required(env, 'API_HOST'),
    port: port(env, 'API_PORT'),
    database: loadDatabaseConfig(env),
    demoMode: loadDemoMode(env),
    demoAllowedOrigins: loadDemoAllowedOrigins(env),
    relay: loadRelayConfig(env),
    telegram: loadTelegramConfig(env),
    providerLimits: loadProviderLimitsConfig(env),
  };
}

/** Runs a loader for a process entry point, exiting with a safe message on invalid configuration. */
export function loadOrExit<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`Invalid configuration: ${error.message}. See .env.example.`);
    process.exit(1);
  }
}
