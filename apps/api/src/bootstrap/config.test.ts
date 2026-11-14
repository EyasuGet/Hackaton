import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('accepts a valid host and port', () => {
    expect(loadConfig({ API_HOST: '127.0.0.1', API_PORT: '3000' })).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it.each([
    ['missing host', { API_PORT: '3000' }, 'API_HOST is required'],
    ['missing port', { API_HOST: '127.0.0.1' }, 'API_PORT is required'],
    ['non-numeric port', { API_HOST: 'h', API_PORT: '3000abc' }, 'API_PORT must be'],
    ['out-of-range port', { API_HOST: 'h', API_PORT: '70000' }, 'API_PORT must be'],
  ])('rejects %s', (_case, env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('does not echo the rejected value', () => {
    const secretLike = 'sk-not-a-port';
    expect(() => loadConfig({ API_HOST: 'h', API_PORT: secretLike })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secretLike) }),
    );
  });
});
