import { client, metricsRegistry } from './registry';

/**
 * HTTP API request metrics (API process).
 * Low-cardinality routes only — path params are normalized.
 */
export const httpRequestsTotal = new client.Counter({
  name: 'einvoice_http_requests_total',
  help: 'HTTP requests to e-invoicing API endpoints',
  labelNames: ['method', 'route', 'status_class'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'einvoice_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

/** Routes we care about for business/API monitoring (prefix match after normalize). */
const MONITORED_ROUTE_PREFIXES = [
  '/v1/webhook/inbound',
  '/v1/workflow/outbound',
  '/v1/workflow/inbound',
  '/v1/workflow/transform',
  '/v1/invoicing/transform',
  '/v1/invoicing/generate-irn',
  '/v1/invoicing/validate',
  '/v1/invoicing/sign',
  '/v1/invoicing/transmit',
  '/v1/invoicing/generate-qr',
  '/v1/invoicing/decrypt',
  '/v1/invoicing/acknowledge',
  '/v1/invoicing/report',
  '/v1/workflow/invoices/outbound',
  '/health',
];

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return '1xx';
}

/**
 * Collapse dynamic segments to keep Prometheus cardinality bounded.
 */
export function normalizeHttpRoute(pathname: string): string | null {
  let path = pathname.split('?')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  // Exact / prefix allowlist first
  const monitored = MONITORED_ROUTE_PREFIXES.some(
    (p) => path === p || path.startsWith(p + '/') || path.startsWith(p)
  );
  if (!monitored && path !== '/health') {
    // Still normalize known patterns below; skip noise if not related
    if (
      !path.startsWith('/v1/webhook') &&
      !path.startsWith('/v1/workflow') &&
      !path.startsWith('/v1/invoicing')
    ) {
      return null;
    }
  }

  // Webhook inbound
  if (/^\/v1\/webhook\/inbound\/[^/]+$/.test(path)) {
    return '/v1/webhook/inbound/:webhookPath';
  }
  if (/^\/v1\/webhook\/listen\/[^/]+$/.test(path)) {
    return '/v1/webhook/listen/:webhookPath';
  }

  // Invoicing IRN-scoped
  if (/^\/v1\/invoicing\/[^/]+\/confirm$/.test(path)) {
    return '/v1/invoicing/:irn/confirm';
  }
  if (/^\/v1\/invoicing\/[^/]+\/status$/.test(path)) {
    return '/v1/invoicing/:irn/status';
  }
  if (/^\/v1\/invoice\/[^/]+\/qr$/.test(path)) {
    return '/v1/invoice/:irn/qr';
  }

  // Transaction logs / recovery
  if (/^\/v1\/workflow\/invoices\/outbound\/[^/]+\/retry-from-step$/.test(path)) {
    return '/v1/workflow/invoices/outbound/:irn/retry-from-step';
  }
  if (/^\/v1\/workflow\/invoices\/outbound\/[^/]+\/resend$/.test(path)) {
    return '/v1/workflow/invoices/outbound/:irn/resend';
  }
  if (/^\/v1\/workflow\/invoices\/outbound\/[^/]+\/payment-status$/.test(path)) {
    return '/v1/workflow/invoices/outbound/:irn/payment-status';
  }
  if (/^\/v1\/workflow\/invoices\/outbound\/[^/]+$/.test(path)) {
    return '/v1/workflow/invoices/outbound/:irn';
  }
  if (/^\/v1\/workflow\/invoices\/inbound\/[^/]+$/.test(path)) {
    return '/v1/workflow/invoices/inbound/:irn';
  }

  // Static monitored paths
  const staticRoutes = [
    '/v1/workflow/outbound',
    '/v1/workflow/inbound',
    '/v1/workflow/transform',
    '/v1/workflow/transform/nrs-schemas',
    '/v1/invoicing/transform',
    '/v1/invoicing/generate-irn',
    '/v1/invoicing/validate',
    '/v1/invoicing/sign',
    '/v1/invoicing/transmit',
    '/v1/invoicing/generate-qr',
    '/v1/invoicing/decrypt',
    '/v1/invoicing/acknowledge',
    '/v1/invoicing/report',
    '/v1/workflow/invoices',
    '/v1/workflow/invoices/metrics',
    '/v1/workflow/invoices/outbound',
    '/v1/workflow/invoices/inbound',
    '/v1/webhook/events',
    '/health',
  ];
  if (staticRoutes.includes(path)) return path;

  // Mapping admin under transform
  if (path.startsWith('/v1/workflow/transform/')) {
    return '/v1/workflow/transform/*';
  }

  return null;
}

export function recordHttpRequest(labels: {
  method: string;
  pathname: string;
  status: number;
  durationSeconds: number;
}): void {
  try {
    const route = normalizeHttpRoute(labels.pathname);
    if (!route) return;

    const method = (labels.method || 'GET').toUpperCase();
    httpRequestsTotal.inc({
      method,
      route,
      status_class: statusClass(labels.status || 500),
    });
    httpRequestDurationSeconds.observe(
      { method, route },
      Math.max(0, labels.durationSeconds)
    );
  } catch {
    // never break requests
  }
}
