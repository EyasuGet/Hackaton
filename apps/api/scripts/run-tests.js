import process from 'node:process';
import { spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const args = rawArgs.map((arg) => arg.replace(/^apps\/api\//, ''));

const result = spawnSync('vitest', ['run', '--exclude', '**/*.integration.test.ts', ...args], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 0);
