import { Router } from 'express';

import type { ReadinessChecker } from './readiness.js';

// Mounted at /health. Probe answers must never be cached by a proxy.
export const createHealthRoutes = (checkReadiness: ReadinessChecker): Router => {
  const router = Router();

  // Liveness: the process can serve HTTP. Touches no dependency, so a database
  // outage makes the API not-ready instead of getting it restarted.
  router.get('/live', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ status: 'ok' });
  });

  // Readiness: one public 503 shape for every reason. The reason is logged by
  // the checker, not shown to unauthenticated callers.
  router.get('/ready', async (_request, response) => {
    const result = await checkReadiness();

    response.setHeader('Cache-Control', 'no-store');

    if (result.status === 'ready') {
      response.status(200).json({ status: 'ready' });
      return;
    }

    response.status(503).json({ status: 'not_ready' });
  });

  return router;
};
