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

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly database: DatabaseConfig;
  /** Enables synthetic demo identities; never a form of real authentication. */
  readonly demoMode: boolean;
  /** Exact page origins allowed to start a demo session, for example `http://localhost:5173`. */
  readonly demoAllowedOrigins: readonly string[];
}

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

export function loadConfig(env: Env): ApiConfig {
  return {
    host: required(env, 'API_HOST'),
    port: port(env, 'API_PORT'),
    database: loadDatabaseConfig(env),
    demoMode: loadDemoMode(env),
    demoAllowedOrigins: loadDemoAllowedOrigins(env),
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
