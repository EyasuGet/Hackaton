// Validates the API's required runtime configuration once at startup.
// Error messages name the offending variable but never echo its value, so a
// misplaced secret cannot leak into logs.

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
}

export class ConfigError extends Error {}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const host = env.API_HOST?.trim();
  if (!host) throw new ConfigError('API_HOST is required');

  const rawPort = env.API_PORT?.trim();
  if (!rawPort) throw new ConfigError('API_PORT is required');
  const port = Number(rawPort);
  // Reject "3000abc", decimals and out-of-range values rather than guessing.
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new ConfigError('API_PORT must be an integer between 1 and 65535');
  }

  return { host, port };
}
