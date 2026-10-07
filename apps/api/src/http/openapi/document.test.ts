import { createLogger } from '@helmrun/logger';
import { systemClock } from '@helmrun/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { createApp } from '../../app.js';
import {
  liveResponseSchema,
  notReadyResponseSchema,
  readyResponseSchema,
} from '../../health/health.schemas.js';
import type { ReadinessChecker } from '../../health/readiness.js';
import { errorResponseSchema } from '../error.middleware.js';
import { REQUEST_ID_HEADER } from '../request-id.middleware.js';
import { buildOpenApiDocument } from './document.js';

const ready: ReadinessChecker = () => Promise.resolve({ status: 'ready' });
const notReady: ReadinessChecker = () =>
  Promise.resolve({ status: 'not_ready', reason: 'draining' });
const broken: ReadinessChecker = () => Promise.reject(new Error('checker bug'));

const createTestApp = (checkReadiness: ReadinessChecker = ready) =>
  createApp({
    logger: createLogger({ level: 'silent', pretty: false, service: 'test', environment: 'test' }),
    clock: systemClock,
    checkReadiness,
  });

const strictLive = z.strictObject(liveResponseSchema.shape);
const strictReady = z.strictObject(readyResponseSchema.shape);
const strictNotReady = z.strictObject(notReadyResponseSchema.shape);
const strictError = z.strictObject({
  error: z.strictObject(errorResponseSchema.shape.error.shape),
});

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const;

const documentedOperations = Object.entries(buildOpenApiDocument().paths ?? {}).flatMap(
  ([path, pathItem]) =>
    HTTP_METHODS.filter((method) => pathItem[method] !== undefined).map(
      (method) => [method, path] as const,
    ),
);

describe('OpenAPI document', () => {
  describe('matches what the app actually sends', () => {
    it.each([
      ['/health/live', 200, 'LiveResponse', strictLive, ready, 'no-store'],
      ['/health/ready', 200, 'ReadyResponse', strictReady, ready, 'no-store'],
      ['/health/ready', 503, 'NotReadyResponse', strictNotReady, notReady, 'no-store'],
      ['/health/ready', 500, 'ErrorResponse', strictError, broken, undefined],
    ] satisfies [string, number, string, z.ZodType, ReadinessChecker, string | undefined][])(
      'GET %s %i: documented as %s, and the actual body and headers match',
      async (path, status, component, schema, checkReadiness, cacheControl) => {
        const document = buildOpenApiDocument();

        const response = await request(createTestApp(checkReadiness)).get(path);

        expect(response.status).toBe(status);
        expect(document).toHaveProperty(
          [
            'paths',
            path,
            'get',
            'responses',
            String(status),
            'content',
            'application/json',
            'schema',
            '$ref',
          ],
          `#/components/schemas/${component}`,
        );
        expect(document).toHaveProperty(['components', 'schemas', component]);
        expect(schema.safeParse(response.body)).toMatchObject({ success: true });
        expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
        if (cacheControl !== undefined) {
          expect(response.headers['cache-control']).toBe(cacheControl);
        }
      },
    );

    it('sends an unknown-route 404 body that parses as ErrorResponse, with a request ID', async () => {
      const response = await request(createTestApp()).get('/nope');

      expect(response.status).toBe(404);
      expect(strictError.safeParse(response.body)).toMatchObject({ success: true });
      expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
    });

    it('rejects bodies with keys the spec does not allow', () => {
      expect(strictNotReady.safeParse({ status: 'not_ready', reason: 'draining' }).success).toBe(
        false,
      );
      expect(
        strictError.safeParse({
          error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: null, stack: 'x' },
        }).success,
      ).toBe(false);
    });
  });

  describe('route coverage (spec to app)', () => {
    it('documents at least one operation', () => {
      expect(documentedOperations.length).toBeGreaterThan(0);
    });

    it.each(documentedOperations)(
      'serves the documented %s %s instead of ROUTE_NOT_FOUND',
      async (method, path) => {
        const response = await request(createTestApp())[method](path);

        expect(response.status).not.toBe(404);
        expect(response.text).not.toContain('ROUTE_NOT_FOUND');
      },
    );
  });
});
