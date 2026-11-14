import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const valid = {
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'track3',
  DATABASE_USER: 'track3',
  DATABASE_PASSWORD: 'local-only',
};

function without(name: keyof typeof valid) {
  const { [name]: _removed, ...rest } = valid;
  return rest;
}

describe('loadConfig', () => {
  it('accepts a complete configuration', () => {
    expect(loadConfig(valid)).toEqual({
      host: '127.0.0.1',
      port: 3000,
      database: {
        host: '127.0.0.1',
        port: 5432,
        database: 'track3',
        user: 'track3',
        password: 'local-only',
      },
      demoMode: false,
      demoAllowedOrigins: [],
    });
  });

  it.each(['null', 'file:///tmp/page.html', 'http://localhost:5173/', 'https://a.example/path'])(
    'rejects %s as a demo origin',
    (origin) => {
      expect(() => loadConfig({ ...valid, DEMO_ALLOWED_ORIGINS: origin })).toThrow(
        'DEMO_ALLOWED_ORIGINS must list exact http(s) origins',
      );
    },
  );

  it('reads a comma-separated list of exact demo origins', () => {
    const origins = ' http://localhost:5173 , https://demo.example.org ';
    expect(loadConfig({ ...valid, DEMO_ALLOWED_ORIGINS: origins }).demoAllowedOrigins).toEqual([
      'http://localhost:5173',
      'https://demo.example.org',
    ]);
  });

  it('enables demo mode only when DEMO_MODE is exactly true', () => {
    expect(loadConfig({ ...valid, DEMO_MODE: 'true' }).demoMode).toBe(true);
    expect(loadConfig({ ...valid, DEMO_MODE: 'false' }).demoMode).toBe(false);
  });

  it.each([
    ['missing API host', without('API_HOST'), 'API_HOST is required'],
    ['missing API port', without('API_PORT'), 'API_PORT is required'],
    ['non-numeric API port', { ...valid, API_PORT: '3000abc' }, 'API_PORT must be'],
    ['out-of-range API port', { ...valid, API_PORT: '70000' }, 'API_PORT must be'],
    ['missing database password', without('DATABASE_PASSWORD'), 'DATABASE_PASSWORD is required'],
    [
      'blank database password',
      { ...valid, DATABASE_PASSWORD: '  ' },
      'DATABASE_PASSWORD is required',
    ],
    ['invalid database port', { ...valid, DATABASE_PORT: 'x' }, 'DATABASE_PORT must be'],
    // A typo must not leave demo access in an unintended state.
    ['ambiguous demo mode', { ...valid, DEMO_MODE: 'yes' }, 'DEMO_MODE must be true or false'],
  ])('rejects %s', (_case, env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('keeps surrounding spaces in the database password', () => {
    expect(loadConfig({ ...valid, DATABASE_PASSWORD: ' spaced ' }).database.password).toBe(
      ' spaced ',
    );
  });

  it('does not echo the rejected value', () => {
    const secretLike = 'sk-not-a-port';
    const load = () => loadConfig({ ...valid, DATABASE_PORT: secretLike });
    expect(load).toThrow(ConfigError);
    expect(load).not.toThrow(secretLike);
  });
});
