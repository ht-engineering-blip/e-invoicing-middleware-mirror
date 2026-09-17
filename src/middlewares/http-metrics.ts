import { Elysia } from 'elysia';
import { recordHttpRequest } from '../@lib/metrics/http.metrics';

function recordOnce(request: Request, status: number): void {
  const req = request as any;
  if (req.__metricsRecorded) return;
  req.__metricsRecorded = true;

  const startedAt = req.__metricsStartedAt as number | undefined;
  const durationSeconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  const url = new URL(request.url);

  recordHttpRequest({
    method: request.method,
    pathname: url.pathname,
    status,
    durationSeconds,
  });
}

/**
 * Records HTTP request count + duration for monitored e-invoicing routes.
 */
export const httpMetricsMiddleware = new Elysia({ name: 'http-metrics' })
  .onRequest(({ request }) => {
    (request as any).__metricsStartedAt = Date.now();
  })
  .onAfterResponse(({ request, set }) => {
    try {
      const status =
        typeof set.status === 'number'
          ? set.status
          : typeof set.status === 'string'
            ? parseInt(set.status, 10) || 200
            : 200;
      recordOnce(request, status);
    } catch {
      // ignore
    }
  })
  .onError(({ request, set, error }) => {
    try {
      let status =
        typeof set.status === 'number'
          ? set.status
          : (error as any)?.statusCode || (error as any)?.status || 500;
      if (typeof status !== 'number') status = 500;
      recordOnce(request, status);
    } catch {
      // ignore
    }
  });
