import { metricsRegistry } from './registry';

export * from './registry';
export * from './invoice.metrics';

/** Render Prometheus exposition format for /metrics scrapers. */
export async function getMetricsText(): Promise<string> {
  return metricsRegistry.metrics();
}

export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}
