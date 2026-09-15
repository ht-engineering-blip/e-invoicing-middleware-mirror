import client from 'prom-client';

/**
 * Shared Prometheus registry for API + worker processes.
 * Default process metrics are opt-in so request-monitoring stays focused.
 */
export const metricsRegistry = new client.Registry();

metricsRegistry.setDefaultLabels({
  service: 'e-invoicing-middleware',
});

export { client };
