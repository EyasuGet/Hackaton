// Contract validation test asserting that Fastify routes, request/response schemas,
// authentication rules, Clean Architecture error envelopes, and example security
// align exactly with the OpenAPI 3.1 specification in docs/contracts/openapi.json (T3-026-A).
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { ResolvePrincipal } from '../identity/application/resolve-principal.ts';

interface OpenApiDoc {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: readonly { readonly url: string }[];
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Record<string, Record<string, OperationDoc>>;
  readonly components: {
    readonly securitySchemes: Record<string, unknown>;
    readonly schemas: Record<string, unknown>;
  };
}

interface OperationDoc {
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly operationId?: string;
  readonly security?: readonly Record<string, unknown>[];
  readonly parameters?: readonly {
    readonly name: string;
    readonly in: string;
    readonly required?: boolean;
  }[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly content?: Record<string, { readonly schema?: unknown; readonly example?: unknown }>;
  };
  readonly responses: Record<
    string,
    {
      readonly description?: string;
      readonly content?: Record<string, { readonly schema?: unknown; readonly example?: unknown }>;
    }
  >;
}

interface ParsedRoute {
  readonly method: string;
  readonly path: string;
}

/** Parses the radix tree output from Fastify printRoutes({ commonPrefix: false }) into normalized routes. */
function parseFastifyRouteTree(tree: string): readonly ParsedRoute[] {
  const lines = tree.split('\n').filter((l) => l.trim().length > 0);
  const stack: { readonly depth: number; readonly path: string }[] = [];
  const routes: ParsedRoute[] = [];

  for (const line of lines) {
    const match = line.match(/^([│\s]*)[├└]──\s+(.*?)(?:\s+\((.*?)\))?$/);
    if (!match) continue;
    const prefix = match[1] ?? '';
    const segment = match[2] ?? '';
    const methodsStr = match[3];
    const depth = prefix.length;

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop();
    }

    const parentPath = stack.length > 0 ? stack[stack.length - 1]!.path : '';
    const fullPath = parentPath + segment;
    stack.push({ depth, path: fullPath });

    if (methodsStr) {
      const methods = methodsStr
        .split(',')
        .map((m) => m.trim().toUpperCase())
        .filter((m) => m !== 'HEAD');
      for (const method of methods) {
        routes.push({ method, path: fullPath });
      }
    }
  }

  return routes;
}

/** Converts Fastify route parameter syntax (:param) to OpenAPI syntax ({param}). */
function fastifyToOpenApiPath(url: string): string {
  return url.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}');
}

const OPENAPI_PATH = fileURLToPath(
  new URL('../../../../../docs/contracts/openapi.json', import.meta.url),
);

describe('OpenAPI 3.1 Specification Contract Validation (T3-026-A)', () => {
  let doc: OpenApiDoc;
  let rawJson: string;
  let app: FastifyInstance;
  let fastifyRoutes: readonly ParsedRoute[];

  beforeAll(async () => {
    expect(fs.existsSync(OPENAPI_PATH), `OpenAPI contract file must exist at ${OPENAPI_PATH}`).toBe(
      true,
    );
    rawJson = fs.readFileSync(OPENAPI_PATH, 'utf-8');
    doc = JSON.parse(rawJson) as OpenApiDoc;

    // Instantiate complete application with proxy stubs for all dependencies so every route is wired
    const dummy = new Proxy({}, { get: () => () => Promise.resolve({}) });
    const dummyRepo = new Proxy({}, { get: () => () => Promise.resolve([]) });

    app = buildApp({
      checkReadiness: () => Promise.resolve({ ready: true }),
      resolvePrincipal: new ResolvePrincipal(
        { findDemoByTokenDigest: () => Promise.resolve(null) },
        true,
      ),
      demoRecords: dummy as never,
      demoSessions: dummy as never,
      demoAllowedOrigins: ['http://localhost:5173'],
      tutoring: dummy as never,
      content: dummy as never,
      help: dummy as never,
      staffHelp: dummy as never,
      sharing: dummy as never,
      accommodation: dummy as never,
      jobRepository: dummyRepo as never,
      jobPreferences: dummy as never,
      telegramService: dummy as never,
    });

    await app.ready();
    const tree = app.printRoutes({ commonPrefix: false });
    fastifyRoutes = parseFastifyRouteTree(tree);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Document structure and metadata', () => {
    it('declares OpenAPI 3.1.0 version', () => {
      expect(doc.openapi).toBe('3.1.0');
    });

    it('contains informative API title, version, and architecture description', () => {
      expect(doc.info.title).toContain('Track 3');
      expect(doc.info.version).toBe('1.0.0');
      expect(doc.info.description).toContain('Clean Architecture');
      expect(doc.info.description).toContain('Offline');
      expect(doc.info.description).toContain('Secrets Hygiene');
    });

    it('declares server and tags', () => {
      expect(Array.isArray(doc.servers)).toBe(true);
      expect(doc.servers.length).toBeGreaterThan(0);
      expect(Array.isArray(doc.tags)).toBe(true);
      expect(doc.tags.length).toBeGreaterThanOrEqual(8);
    });

    it('defines BearerAuth and TelegramWebhookSecret security schemes', () => {
      const schemes = doc.components.securitySchemes;
      expect(schemes).toBeDefined();
      expect(schemes['BearerAuth']).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });
      expect(schemes['TelegramWebhookSecret']).toMatchObject({
        type: 'apiKey',
        in: 'header',
        name: 'x-telegram-bot-api-secret-token',
      });
    });
  });

  describe('Route alignment between Fastify and OpenAPI', () => {
    it('covers all registered Fastify routes in OpenAPI paths', () => {
      for (const route of fastifyRoutes) {
        const openApiPath = fastifyToOpenApiPath(route.path);
        const pathItem = doc.paths[openApiPath];
        expect(
          pathItem,
          `Expected OpenAPI document to include path "${openApiPath}" for Fastify route ${route.method} ${route.path}`,
        ).toBeDefined();

        const methodKey = route.method.toLowerCase();
        expect(
          pathItem?.[methodKey],
          `Expected OpenAPI path "${openApiPath}" to define method "${methodKey}" for Fastify route ${route.method} ${route.path}`,
        ).toBeDefined();
      }
    });

    it('does not document absent or non-existent Fastify routes in OpenAPI', () => {
      // Create a set of normalized "METHOD /path" strings from Fastify
      const fastifyRouteSet = new Set(
        fastifyRoutes.map((r) => `${r.method.toUpperCase()} ${fastifyToOpenApiPath(r.path)}`),
      );

      // Iterate every operation declared in OpenAPI
      for (const [openApiPath, methods] of Object.entries(doc.paths)) {
        for (const [method, op] of Object.entries(methods)) {
          if (['parameters', 'summary', 'description', 'servers'].includes(method)) continue;
          const key = `${method.toUpperCase()} ${openApiPath}`;
          expect(
            fastifyRouteSet.has(key),
            `OpenAPI documents absent route "${key}" (operationId: ${op.operationId}) which is not registered in Fastify`,
          ).toBe(true);
        }
      }
    });

    it('achieves exact 1-to-1 route and method parity', () => {
      let openApiOpCount = 0;
      for (const methods of Object.values(doc.paths)) {
        for (const method of Object.keys(methods)) {
          if (!['parameters', 'summary', 'description', 'servers'].includes(method)) {
            openApiOpCount++;
          }
        }
      }
      expect(openApiOpCount).toBe(fastifyRoutes.length);
    });
  });

  describe('Clean Architecture error envelopes and response contracts', () => {
    it('ensures every operation defines at least one success response and error envelope schemas', () => {
      for (const [openApiPath, methods] of Object.entries(doc.paths)) {
        for (const [method, op] of Object.entries(methods)) {
          if (['parameters', 'summary', 'description', 'servers'].includes(method)) continue;
          const operation = op;
          const statusCodes = Object.keys(operation.responses);

          // Must have at least one success response (200, 201, or 204)
          const hasSuccess = statusCodes.some((code) => code.startsWith('2'));
          expect(
            hasSuccess,
            `Operation ${method.toUpperCase()} ${openApiPath} must define at least one 2xx success response`,
          ).toBe(true);

          // Any 4xx or 5xx response returning JSON must use standardized error schema
          for (const code of statusCodes) {
            if (code.startsWith('4') || code.startsWith('5')) {
              const resp = operation.responses[code];
              if (resp?.content?.['application/json']) {
                const schema = resp.content['application/json'].schema as Record<string, unknown>;
                const hasRef = typeof schema?.$ref === 'string';
                const hasErrorProp =
                  typeof schema?.properties === 'object' &&
                  (schema.properties as Record<string, unknown>)['error'] !== undefined;
                const hasStatusProp =
                  typeof schema?.properties === 'object' &&
                  (schema.properties as Record<string, unknown>)['status'] !== undefined;

                expect(
                  hasRef || hasErrorProp || hasStatusProp,
                  `Error response ${code} for ${method.toUpperCase()} ${openApiPath} must adhere to standardized error envelope`,
                ).toBe(true);
              }
            }
          }
        }
      }
    });

    it('ensures protected operations document 401 and/or 403 responses', () => {
      for (const [openApiPath, methods] of Object.entries(doc.paths)) {
        for (const [method, op] of Object.entries(methods)) {
          if (['parameters', 'summary', 'description', 'servers'].includes(method)) continue;
          const operation = op;
          if (operation.security && operation.security.length > 0) {
            const hasAuthScheme = operation.security.some(
              (s) => s['BearerAuth'] || s['TelegramWebhookSecret'],
            );
            if (hasAuthScheme) {
              const has401 = operation.responses['401'] !== undefined;
              expect(
                has401,
                `Protected operation ${method.toUpperCase()} ${openApiPath} must document 401 Unauthorized response`,
              ).toBe(true);
            }
          }
        }
      }
    });

    it('ensures resource-by-id operations document 404 response', () => {
      for (const [openApiPath, methods] of Object.entries(doc.paths)) {
        if (openApiPath.includes('{id}') || openApiPath.includes('{sectionId}')) {
          for (const [method, op] of Object.entries(methods)) {
            if (['parameters', 'summary', 'description', 'servers'].includes(method)) continue;
            const operation = op;
            // GET / DELETE by ID should define 404
            if (method === 'get' || method === 'delete') {
              expect(
                operation.responses['404'] !== undefined,
                `Resource-by-id operation ${method.toUpperCase()} ${openApiPath} must document 404 Not Found response`,
              ).toBe(true);
            }
          }
        }
      }
    });

    it('declares all path parameters defined in route patterns', () => {
      for (const [openApiPath, methods] of Object.entries(doc.paths)) {
        const paramMatches = [...openApiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)];
        const expectedParamNames = paramMatches.map((m) => m[1]);

        if (expectedParamNames.length > 0) {
          for (const [method, op] of Object.entries(methods)) {
            if (['parameters', 'summary', 'description', 'servers'].includes(method)) continue;
            const operation = op;
            const declaredParams =
              operation.parameters?.filter((p) => p.in === 'path').map((p) => p.name) ?? [];
            for (const param of expectedParamNames) {
              expect(
                declaredParams.includes(param!),
                `Operation ${method.toUpperCase()} ${openApiPath} must declare path parameter "${param}"`,
              ).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('Secrets and sensitive data hygiene in examples', () => {
    it('asserts no real secrets, private keys, or credentials exist in the specification', () => {
      // Check for forbidden secret patterns across the entire raw JSON
      const forbiddenPatterns: { readonly pattern: RegExp; readonly description: string }[] = [
        { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, description: 'Private key block' },
        { pattern: /AIzaSy[A-Za-z0-9_-]{33}/, description: 'Google Gemini API key' },
        { pattern: /sk-[A-Za-z0-9]{20,}/, description: 'OpenAI API key' },
        {
          pattern: /postgres:\/\/[^:]+:[^@]+@/,
          description: 'Database connection string with credentials',
        },
        { pattern: /\b[0-9]{9,10}:[A-Za-z0-9_-]{35}\b/, description: 'Telegram bot token format' },
      ];

      for (const { pattern, description } of forbiddenPatterns) {
        expect(pattern.test(rawJson), `OpenAPI specification must not contain ${description}`).toBe(
          false,
        );
      }
    });

    it('ensures examples only use synthetic, anonymized placeholders', () => {
      // Verify examples in the schema use synthetic prefixes
      const schemas = doc.components.schemas as Record<
        string,
        {
          readonly example?: unknown;
          readonly properties?: Record<string, { readonly example?: unknown }>;
        }
      >;
      for (const [schemaName, schemaObj] of Object.entries(schemas)) {
        if (schemaObj.properties) {
          for (const [propName, propObj] of Object.entries(schemaObj.properties)) {
            if (
              propName.toLowerCase().includes('token') ||
              propName.toLowerCase().includes('code') ||
              propName.toLowerCase().includes('secret')
            ) {
              if (typeof propObj.example === 'string') {
                expect(
                  propObj.example.startsWith('synthetic') ||
                    propObj.example.startsWith('demo') ||
                    propObj.example.startsWith('test'),
                  `Example for ${schemaName}.${propName} should be explicitly synthetic: got "${propObj.example}"`,
                ).toBe(true);
              }
            }
          }
        }
      }
    });
  });

  describe('Live execution verification (Issue #59 human verification gate)', () => {
    it('verifies documented 401 Unauthorized envelope when accessing protected route without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/me',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthenticated' });
    });

    it('verifies documented 400 Bad Request error envelope on invalid input to protected operation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/demo/session',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
        },
        payload: {
          code: 'short', // Invalid format; minLength is 20
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json<{ statusCode: number; error: string }>();
      expect(json.statusCode).toBe(400);
      expect(json.error).toBe('Bad Request');
    });

    it('verifies documented 200 OK liveness probe contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('verifies documented 200 OK readiness probe contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ready',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready' });
    });
  });
});
