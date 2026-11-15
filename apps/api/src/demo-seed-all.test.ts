import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Demo Stack & Seed Configuration (T3-043)', () => {
  it('defines demo seed entry script with all required setup stages', () => {
    const seedPath = join(__dirname, 'demo-seed-all.ts');
    expect(existsSync(seedPath)).toBe(true);
    const content = readFileSync(seedPath, 'utf8');

    // Asserts all 4 stages of one-shot setup
    expect(content).toContain('Applying database migrations');
    expect(content).toContain('provisionDemoPrincipals');
    expect(content).toContain('ImportLessonSource');
    expect(content).toContain('ImportJobs');
    expect(content).toContain('issueHandoff');
  });

  it('provides compose.demo.yaml and profile demo in compose.yaml', () => {
    const rootDir = join(__dirname, '../../..');
    const composeDemo = join(rootDir, 'compose.demo.yaml');
    const composeMain = join(rootDir, 'compose.yaml');

    expect(existsSync(composeDemo)).toBe(true);
    expect(existsSync(composeMain)).toBe(true);

    const mainContent = readFileSync(composeMain, 'utf8');
    expect(mainContent).toContain('profiles:');
    expect(mainContent).toContain('- demo');
    expect(mainContent).toContain('demo-seed-all.ts');
  });
});
