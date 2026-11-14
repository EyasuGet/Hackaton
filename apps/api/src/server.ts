// API process entry point: validate configuration, then listen.
import { buildApp } from './app.ts';
import { ConfigError, loadConfig, type ApiConfig } from './config.ts';

let config: ApiConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`Invalid configuration: ${error.message}. See .env.example.`);
  process.exit(1);
}

const app = buildApp({ logger: true });
await app.listen({ host: config.host, port: config.port });
