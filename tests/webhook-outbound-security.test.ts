import { mock } from 'bun:test';
import path from 'node:path';
import dns from 'node:dns';

// Mock @agendajs/mongo-backend globally to completely suppress any MongoBackend connection attempts
mock.module('@agendajs/mongo-backend', () => {
  return {
    MongoBackend: class {
      constructor() {}
      async connect() {
        return this;
      }
      async database() {
        return {
          collection: () => ({
            findOne: () => Promise.resolve(null),
            find: () => ({
              toArray: () => Promise.resolve([]),
            }),
            insertOne: () => Promise.resolve({}),
            updateOne: () => Promise.resolve({}),
            createIndex: () => Promise.resolve({}),
          }),
        };
      }
    }
  };
});

// Mock agenda globally using all possible path permutations to guarantee resolution matching
const mockAgenda = {
  define: () => {},
  on: () => {},
  start: async () => {},
  schedule: async () => {},
  now: async () => {},
  cancel: async () => {},
};

const agendaPath = path.resolve(import.meta.dir, '../src/@lib/queue/agenda');
const pathsToMock = [
  agendaPath,
  `${agendaPath}.ts`,
  agendaPath.replace(/\\/g, '/'),
  `${agendaPath.replace(/\\/g, '/')}.ts`,
  agendaPath.toLowerCase(),
  `${agendaPath.toLowerCase()}.ts`,
  '../src/@lib/queue/agenda.ts',
  '../src/@lib/queue/agenda',
  '@lib/queue/agenda',
];

for (const p of pathsToMock) {
  mock.module(p, () => ({
    agenda: mockAgenda
  }));
}

// Silence background MongoDB connection rejections during offline unit tests
process.on('unhandledRejection', (reason) => {
  const reasonStr = String(reason);
  if (reasonStr.includes('mongodb') || reasonStr.includes('ECONNREFUSED') || reasonStr.includes('querySrv')) {
    return; // Silently swallow background connection failures
  }
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  const errStr = String(err);
  if (errStr.includes('mongodb') || errStr.includes('ECONNREFUSED') || errStr.includes('querySrv')) {
    return; // Silently swallow background connection failures
  }
  console.error('Uncaught Exception:', err);
});

import { describe, it, expect, spyOn, beforeAll } from 'bun:test';

describe('Outbound Webhook Security & CORS Tests', () => {
  let webhookService: any;
  let webhookRoutes: any;
  let webhookPathToOriginCache: any;

  const mockTenant = {
    tenantId: 'tenant-123',
    status: 'active',
    config: {
      webhookEnabled: true,
      webhookUrl: 'https://allowed-origin.com/callback',
      webhookAuth: 'super-secret',
    },
  };

  const mockEvent = {
    eventId: 'wh_event_123',
    tenantId: 'tenant-123',
    eventType: 'invoice.received',
    payload: { id: 1 },
    deliveryAttempts: [],
  };

  beforeAll(async () => {
    const { WebhookService } = await import('../src/v1/webhook/services/webhook.service');
    const { WebhookEventRepository } = await import('../src/v1/webhook/repos/webhook-event.repo');
    const { TenantRepository } = await import('../src/v1/tenants/repos/tenant.repo');
    const { AuditLogRepository } = await import('../src/v1/audit/repos/audit-log.repo');
    const routesMod = await import('../src/v1/webhook');
    webhookRoutes = routesMod.webhookRoutes;
    const cacheMod = await import('../src/v1/webhook/utils/cors-cache');
    webhookPathToOriginCache = cacheMod.webhookPathToOriginCache;
    const axios = (await import('axios')).default;

    webhookService = new WebhookService();

    // Populate CORS cache
    webhookPathToOriginCache.set('valid-path', 'https://allowed-origin.com');

    // Mock Repositories
    spyOn(TenantRepository.prototype, 'findByTenantId').mockImplementation(async (id) => {
      if (id === 'tenant-123') return mockTenant as any;
      return null;
    });

    spyOn(TenantRepository.prototype, 'findByWebhookPath').mockImplementation(async (path) => {
      if (path === 'valid-path') {
        return {
          tenantId: 'tenant-123',
          config: {
            webhookUrl: 'https://allowed-origin.com/callback',
          },
        } as any;
      }
      return null;
    });

    spyOn(WebhookEventRepository.prototype, 'findById').mockImplementation(async (id) => {
      if (id === 'wh_event_123') return mockEvent as any;
      return null;
    });

    spyOn(WebhookEventRepository.prototype, 'markAsFailed').mockImplementation(async (id, reason, status) => {
      return { ...mockEvent, status: 'failed', failureReason: reason } as any;
    });

    spyOn(WebhookEventRepository.prototype, 'markAsDelivered').mockImplementation(async (id, status, body) => {
      return { ...mockEvent, status: 'delivered' } as any;
    });

    spyOn(WebhookEventRepository.prototype, 'addDeliveryAttempt').mockImplementation(async () => {
      return {} as any;
    });

    spyOn(AuditLogRepository.prototype, 'create').mockImplementation(async () => {
      return {} as any;
    });

    // Mock axios.post
    spyOn(axios, 'post').mockImplementation(async (url, payload, config) => {
      if (config && config.maxRedirects === 0) {
        return { status: 200, data: { success: true } } as any;
      }
      throw new Error('Redirects not limited');
    });
  });

  describe('SSRF Outbound Guard', () => {
    it('should block private/reserved IP space webhooks', async () => {
      mockTenant.config.webhookUrl = 'https://192.168.1.1/callback';
      expect(webhookService.deliverWebhook('wh_event_123')).rejects.toThrow(
        'Outbound webhook URL is blocked by SSRF guard'
      );
    });

    it('should block non-https webhooks', async () => {
      mockTenant.config.webhookUrl = 'http://google.com/callback';
      expect(webhookService.deliverWebhook('wh_event_123')).rejects.toThrow(
        'Outbound webhook URL is blocked by SSRF guard'
      );
    });

    it('should block loopback interface webhooks', async () => {
      mockTenant.config.webhookUrl = 'https://localhost/callback';
      expect(webhookService.deliverWebhook('wh_event_123')).rejects.toThrow(
        'Outbound webhook URL is blocked by SSRF guard'
      );
    });

    it('should allow valid public HTTPS webhooks', async () => {
      mockTenant.config.webhookUrl = 'https://google.com/callback';
      const result = await webhookService.deliverWebhook('wh_event_123');
      expect(result).toBeDefined();
    });
  });

  describe('CORS Dynamic Origin Guard', () => {
    it('should allow request from matching tenant-registered origin', async () => {
      const app = webhookRoutes;
      const response = await app.handle(
        new Request('http://localhost/webhook/inbound/valid-path', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://allowed-origin.com',
            'Access-Control-Request-Method': 'POST',
          },
        })
      );
      expect(response.headers.get('access-control-allow-origin')).toBe('https://allowed-origin.com');
    });

    it('should block request from non-matching origin', async () => {
      const app = webhookRoutes;
      const response = await app.handle(
        new Request('http://localhost/webhook/inbound/valid-path', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://attacker.com',
            'Access-Control-Request-Method': 'POST',
          },
        })
      );
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
