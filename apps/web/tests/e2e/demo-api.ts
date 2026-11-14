// Runs the API's real operator commands (provisioning, sign-in links, content
// import) against the test database, with demo mode enabled for the page origin.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiDir = fileURLToPath(new URL('../../../api/', import.meta.url));
const demoEnv = {
  ...process.env,
  DEMO_MODE: 'true',
  DEMO_ALLOWED_ORIGINS: 'http://localhost:5173',
};

export function runApi(script: string, ...args: string[]): string {
  return execFileSync('node', ['--env-file-if-exists=../../.env', script, ...args], {
    cwd: apiDir,
    env: demoEnv,
    encoding: 'utf8',
  });
}

export function newHandoffCode(principal: string): string {
  const code = /^Code: (\S+)$/m.exec(runApi('src/demo-handoff.ts', principal))?.[1];
  if (!code) throw new Error('demo:handoff printed no code');
  return code;
}
