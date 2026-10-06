import { createDocument, type oas31 } from 'zod-openapi';

import {
  liveResponseSchema,
  notReadyResponseSchema,
  readyResponseSchema,
} from '../../health/health.schemas.js';
import { REQUEST_ID_HEADER } from '../request-id.middleware.js';

// Contract version, not the package version: bump it when the public API
// changes in a way clients notice.
export const API_CONTRACT_VERSION = '0.1.0';

// Set on every response by the request ID middleware; every operation spreads
// this in so a new route can't leave it out.
const commonResponseHeaders = {
  [REQUEST_ID_HEADER]: {
    description: 'ID of this request; quote it when reporting a problem.',
    schema: { type: 'string' },
  },
} satisfies oas31.HeadersObject;

const probeHeaders = {
  ...commonResponseHeaders,
  'Cache-Control': {
    description: 'Probe answers are never cached.',
    schema: { type: 'string', enum: ['no-store'] },
  },
} satisfies oas31.HeadersObject;

// Pure: builds the document from the route schemas. scripts/generate-openapi.ts
// writes it to openapi.json; tests can call it directly.
export const buildOpenApiDocument = (): ReturnType<typeof createDocument> =>
  createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Helmrun API',
      version: API_CONTRACT_VERSION,
      description: 'Control-plane API for running AI agents.',
    },
    tags: [{ name: 'health', description: 'Liveness and readiness probes' }],
    paths: {
      '/health/live': {
        get: {
          operationId: 'getLiveness',
          tags: ['health'],
          summary: 'Liveness probe',
          description: 'Checks no dependencies: a database outage must not restart the API.',
          responses: {
            '200': {
              description: 'The process is alive.',
              headers: probeHeaders,
              content: { 'application/json': { schema: liveResponseSchema } },
            },
          },
        },
      },
      '/health/ready': {
        get: {
          operationId: 'getReadiness',
          tags: ['health'],
          summary: 'Readiness probe',
          description: 'One public 503 shape for every reason; the reason is only logged.',
          responses: {
            '200': {
              description: 'Ready to serve traffic.',
              headers: probeHeaders,
              content: { 'application/json': { schema: readyResponseSchema } },
            },
            '503': {
              description: 'Not ready: draining, or a dependency is unavailable.',
              headers: probeHeaders,
              content: { 'application/json': { schema: notReadyResponseSchema } },
            },
          },
        },
      },
    },
  });
