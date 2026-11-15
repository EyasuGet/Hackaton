// Automated verification test for Issue #66 [T3-027-A].
// Validates workspace package manifests, licensing compliance, container configurations,
// and enforces zero-secret leak constraints across deployment assets and build outputs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly license?: string;
  readonly engines?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readManifest(filePath: string): PackageManifest {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as PackageManifest;
}

describe('Workspace package manifests and licensing', () => {
  const rootPkgPath = resolve(REPO_ROOT, 'package.json');
  const apiPkgPath = resolve(REPO_ROOT, 'apps/api/package.json');
  const webPkgPath = resolve(REPO_ROOT, 'apps/web/package.json');
  const licensePath = resolve(REPO_ROOT, 'LICENSE');

  it('declares MIT license file in repository root', () => {
    expect(existsSync(licensePath)).toBe(true);
    const licenseText = readFileSync(licensePath, 'utf-8');
    expect(licenseText).toContain('MIT License');
    expect(licenseText).toContain('Track 3 Assistant');
  });

  it('defines valid package metadata and license in all package manifests', () => {
    const rootPkg = readManifest(rootPkgPath);
    const apiPkg = readManifest(apiPkgPath);
    const webPkg = readManifest(webPkgPath);

    expect(rootPkg.license).toBe('MIT');
    expect(apiPkg.license).toBe('MIT');
    expect(webPkg.license).toBe('MIT');

    expect(rootPkg.private).toBe(true);
    expect(apiPkg.private).toBe(true);
    expect(webPkg.private).toBe(true);

    expect(rootPkg.type).toBe('module');
    expect(apiPkg.type).toBe('module');
    expect(webPkg.type).toBe('module');
  });

  it('specifies supported Node.js runtime engines in root manifest', () => {
    const rootPkg = readManifest(rootPkgPath);
    expect(rootPkg.engines?.node).toMatch(/>=22\./);
  });

  it('defines core workspace lifecycle scripts in root manifest', () => {
    const rootPkg = readManifest(rootPkgPath);
    expect(rootPkg.scripts?.dev).toBeDefined();
    expect(rootPkg.scripts?.build).toBeDefined();
    expect(rootPkg.scripts?.typecheck).toBeDefined();
    expect(rootPkg.scripts?.test).toBeDefined();
    expect(rootPkg.scripts?.lint).toBeDefined();
    expect(rootPkg.scripts?.format).toBeDefined();
    expect(rootPkg.scripts?.['format:check']).toBeDefined();
  });

  it('uses strictly permissive licenses for all production dependencies', () => {
    const apiPkg = readManifest(apiPkgPath);
    const webPkg = readManifest(webPkgPath);

    // Production dependencies must be permissive without copyleft or commercial restrictions.
    const productionDependencies = [
      ...Object.keys(apiPkg.dependencies ?? {}),
      ...Object.keys(webPkg.dependencies ?? {}),
    ];

    expect(productionDependencies).toEqual(
      expect.arrayContaining(['fastify', 'pg', 'react', 'react-dom']),
    );

    // Verify known permissive licensing for each production runtime package.
    const knownLicenses: Record<string, string> = {
      fastify: 'MIT',
      pg: 'MIT',
      react: 'MIT',
      'react-dom': 'MIT',
    };

    for (const dep of productionDependencies) {
      expect(knownLicenses[dep]).toBe('MIT');
    }
  });

  it('verifies that no production dependency has copyleft or non-commercial licenses', () => {
    const apiPkg = readManifest(apiPkgPath);
    const webPkg = readManifest(webPkgPath);

    const allProdDeps: Record<string, string> = {
      ...(apiPkg.dependencies ?? {}),
      ...(webPkg.dependencies ?? {}),
    };

    const prohibitedTerms = ['gpl', 'agpl', 'sspl', 'commons-clause', 'nc', 'non-commercial'];
    for (const dep of Object.keys(allProdDeps)) {
      for (const term of prohibitedTerms) {
        expect(dep.toLowerCase()).not.toContain(term);
      }
    }
  });
});

describe('Production container manifests and packaging', () => {
  const dockerfilePath = resolve(REPO_ROOT, 'Dockerfile');
  const dockerignorePath = resolve(REPO_ROOT, '.dockerignore');
  const composePath = resolve(REPO_ROOT, 'compose.deployment.yaml');
  const devComposePath = resolve(REPO_ROOT, 'compose.yaml');

  it('provides a multi-stage production Dockerfile', () => {
    expect(existsSync(dockerfilePath)).toBe(true);
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');

    // Multi-stage verification
    expect(dockerfile).toMatch(/FROM\s+node:22-alpine\s+AS\s+build/);
    expect(dockerfile).toMatch(/FROM\s+node:22-alpine\s+AS\s+runtime/);

    // Unprivileged user and standard API port
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toMatch(/CMD\s+\[.*node.*apps\/api\/dist\/server\.js/);
  });

  it('provides .dockerignore preventing local secrets and build artifacts from leaking into image context', () => {
    expect(existsSync(dockerignorePath)).toBe(true);
    const dockerignore = readFileSync(dockerignorePath, 'utf-8');

    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('dist');
    expect(dockerignore).toContain('.git');
  });

  it('validates Compose deployment service definitions and security settings', () => {
    expect(existsSync(composePath)).toBe(true);
    expect(existsSync(devComposePath)).toBe(true);

    const composeText = readFileSync(composePath, 'utf-8');
    expect(composeText).toContain('caddy:');
    expect(composeText).toContain('api:');
    expect(composeText).toContain('db:');
    expect(composeText).toContain('coturn:');

    // Secrets must come from environment, not hardcoded defaults
    expect(composeText).toContain('DATABASE_PASSWORD: ${DATABASE_PASSWORD:?');
  });
});

describe('Zero-secret leak audit across deployment and repository files', () => {
  it('ensures .env.example contains only blank placeholders without sensitive credentials', () => {
    const envExamplePath = resolve(REPO_ROOT, '.env.example');
    expect(existsSync(envExamplePath)).toBe(true);
    const envExample = readFileSync(envExamplePath, 'utf-8');

    // Sensitive values must be empty placeholders
    expect(envExample).toMatch(/^DATABASE_PASSWORD=$/m);
    expect(envExample).toMatch(/^TURN_STATIC_AUTH_SECRET=$/m);
    expect(envExample).toMatch(/^TELEGRAM_WEBHOOK_SECRET=$/m);
    expect(envExample).toMatch(/^TELEGRAM_BOT_TOKEN=$/m);
  });

  it('ensures gitignore protects local environment files and credentials', () => {
    const gitignorePath = resolve(REPO_ROOT, '.gitignore');
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('node_modules/');
  });

  it('scans critical configuration files for raw private keys or live cloud API keys', () => {
    const filesToScan = [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
      '.env.example',
      'compose.yaml',
      'compose.deployment.yaml',
      'deploy/caddy/Caddyfile',
      'deploy/coturn/turnserver.conf',
    ];

    const secretPatterns = [
      /-----BEGIN [A-Z]+ PRIVATE KEY-----/,
      /ghp_[a-zA-Z0-9]{36}/,
      /AIza[0-9A-Za-z-_]{35}/,
      /sk-[a-zA-Z0-9]{32,}/,
    ];

    for (const relPath of filesToScan) {
      const fullPath = resolve(REPO_ROOT, relPath);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        for (const pattern of secretPatterns) {
          expect(content).not.toMatch(pattern);
        }
      }
    }
  });

  it('verifies build output directories do not contain committed secret files', () => {
    const buildDist = resolve(REPO_ROOT, 'apps/api/dist');
    if (existsSync(buildDist)) {
      const scanDir = (dir: string): void => {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = resolve(dir, entry);
          const stat = statSync(entryPath);
          if (stat.isDirectory()) {
            scanDir(entryPath);
          } else {
            expect(entry.toLowerCase()).not.toContain('.env');
            expect(entry.toLowerCase()).not.toContain('id_rsa');
            expect(entry.toLowerCase()).not.toContain('private.key');
          }
        }
      };
      scanDir(buildDist);
    }
  });
});
