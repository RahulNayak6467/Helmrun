import * as z from 'zod';

// Response bodies for the probe endpoints. Handlers are typed with these
// (z.infer), and the OpenAPI document is generated from them (decision 014),
// so the code and the spec share one definition. `id` makes each a named
// component in the spec.
export const liveResponseSchema = z
  .object({ status: z.literal('ok') })
  .meta({ id: 'LiveResponse', description: 'The process is up and serving HTTP.' });

export const readyResponseSchema = z
  .object({ status: z.literal('ready') })
  .meta({ id: 'ReadyResponse', description: 'The API can serve traffic.' });

export const notReadyResponseSchema = z.object({ status: z.literal('not_ready') }).meta({
  id: 'NotReadyResponse',
  description: 'The API should not receive traffic (draining or a dependency is down).',
});

export type LiveResponse = z.infer<typeof liveResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
export type NotReadyResponse = z.infer<typeof notReadyResponseSchema>;
