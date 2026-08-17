import { mock } from 'bun:test';
import path from 'node:path';

// Mock @agendajs/mongo-backend globally
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
    },
  };
});

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
  '../src/@lib/queue/agenda.ts',
  '../src/@lib/queue/agenda',
  '@lib/queue/agenda',
];

for (const p of pathsToMock) {
  mock.module(p, () => ({
    agenda: mockAgenda,
  }));
}

// Silence background MongoDB connection rejections
process.on('unhandledRejection', (reason) => {
  const reasonStr = String(reason);
  if (reasonStr.includes('mongodb') || reasonStr.includes('ECONNREFUSED') || reasonStr.includes('querySrv')) {
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

import { describe, it, expect, spyOn, beforeAll } from 'bun:test';
import { Elysia } from 'elysia';
import * as jwt from 'jsonwebtoken';
import { jwtConfig } from '../src/@config/jwt';
import { TenantRepository } from '../src/v1/tenants/repos/tenant.repo';
import { WebhookEventRepository } from '../src/v1/webhook/repos/webhook-event.repo';
import { webhookEventRoutes } from '../src/v1/webhook/routes/webhook-events.routes';

describe('Webhook Events Search & Filter Tests', () => {
  let app: any;
  let findSpy: any;
  let countSpy: any;
  let findTenantSpy: any;
  let mockToken: string;

  const mockEvents = [
    {
      eventId: 'wh_evt_001',
      tenantId: 'tenant-123',
      eventType: 'invoice.created',
      status: 'delivered',
      resourceId: 'F1DFF-999',
      resourceType: 'invoice',
      metadata: { irn: 'F1DFF-999', erpInvoiceId: 'INV-101' },
      jobErrors: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      eventId: 'wh_evt_002',
      tenantId: 'tenant-123',
      eventType: 'invoice.validated',
      status: 'pending',
      resourceId: 'INV-OTHER-456',
      resourceType: 'invoice',
      metadata: { irn: 'IRN-F1DFF-XYZ', erpInvoiceId: 'INV-102' },
      jobErrors: [],
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
    {
      eventId: 'wh_evt_003',
      tenantId: 'tenant-123',
      eventType: 'invoice.failed',
      status: 'failed',
      resourceId: 'OTHER-789',
      resourceType: 'invoice',
      metadata: { erpInvoiceId: 'INV-103' },
      jobErrors: [{ step: 1, action: 'transmit', jobChainId: 'c1', error: 'failed', failedAt: new Date() }],
      createdAt: new Date('2026-01-03T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
    },
  ];

  beforeAll(async () => {
    findTenantSpy = spyOn(TenantRepository.prototype, 'findByTenantId').mockImplementation(async (id: string) => {
      return {
        tenantId: id,
        status: 'active',
        config: {
          webhookEnabled: true,
          webhookUrl: 'https://example.com/webhook',
        },
      } as any;
    });

    mockToken = jwt.sign(
      {
        tenantId: 'tenant-123',
        businessId: 'biz-123',
        scopes: ['*'],
      },
      jwtConfig?.secret!,
      { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
    );

    findSpy = spyOn(WebhookEventRepository.prototype, 'find').mockImplementation(async (query: any) => {
      return mockEvents.filter((ev) => {
        if (query.tenantId && ev.tenantId !== query.tenantId) return false;
        if (query.$and) {
          return query.$and.every((cond: any) => {
            if (cond.tenantId && ev.tenantId !== cond.tenantId) return false;
            if (cond.eventType && ev.eventType !== cond.eventType) return false;
            if (cond.status && ev.status !== cond.status) return false;
            if (cond.$or) {
              return cond.$or.some((branch: any) => {
                if (branch['metadata.irn']?.$regex) {
                  const re = new RegExp(branch['metadata.irn'].$regex, branch['metadata.irn'].$options || '');
                  if (ev.metadata?.irn && re.test(ev.metadata.irn)) return true;
                }
                if (branch.resourceId?.$regex) {
                  const re = new RegExp(branch.resourceId.$regex, branch.resourceId.$options || '');
                  if (ev.resourceId && re.test(ev.resourceId)) return true;
                }
                if (branch.eventId?.$regex) {
                  const re = new RegExp(branch.eventId.$regex, branch.eventId.$options || '');
                  if (ev.eventId && re.test(ev.eventId)) return true;
                }
                if (branch.eventType?.$regex) {
                  const re = new RegExp(branch.eventType.$regex, branch.eventType.$options || '');
                  if (ev.eventType && re.test(ev.eventType)) return true;
                }
                return false;
              });
            }
            return true;
          });
        }
        return true;
      }) as any;
    });

    countSpy = spyOn(WebhookEventRepository.prototype, 'count').mockImplementation(async (query: any) => {
      const results = await WebhookEventRepository.prototype.find.call({} as any, query);
      return results.length;
    });

    app = new Elysia().use(webhookEventRoutes);
  });

  const makeReq = (url: string) => {
    return new Request(url, {
      headers: {
        Authorization: `Bearer ${mockToken}`,
      },
    });
  };

  it('filters by irn with partial substring match and updates meta.total', async () => {
    const res = await app.handle(makeReq('http://localhost/webhook/events?irn=F1DFF&page=1&limit=10'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);
    expect(json.meta.total).toBe(2);
    expect(json.meta.pages).toBe(1);
    expect(json.data[0].irn).toContain('F1DFF');
    expect(json.data[1].irn).toContain('F1DFF');
  });

  it('filters by search across irn, eventId, and eventType', async () => {
    // Search by eventId
    const resId = await app.handle(makeReq('http://localhost/webhook/events?search=wh_evt_003'));
    const jsonId = await resId.json();
    expect(jsonId.success).toBe(true);
    expect(jsonId.data.length).toBe(1);
    expect(jsonId.data[0].eventId).toBe('wh_evt_003');
    expect(jsonId.meta.total).toBe(1);

    // Search by eventType
    const resType = await app.handle(makeReq('http://localhost/webhook/events?search=invoice.created'));
    const jsonType = await resType.json();
    expect(jsonType.success).toBe(true);
    expect(jsonType.data.length).toBe(1);
    expect(jsonType.data[0].eventType).toBe('invoice.created');
    expect(jsonType.meta.total).toBe(1);

    // Search by irn
    const resIrn = await app.handle(makeReq('http://localhost/webhook/events?search=F1DFF'));
    const jsonIrn = await resIrn.json();
    expect(jsonIrn.success).toBe(true);
    expect(jsonIrn.data.length).toBe(2);
    expect(jsonIrn.meta.total).toBe(2);
  });

  it('returns empty result when no match found', async () => {
    const res = await app.handle(makeReq('http://localhost/webhook/events?irn=NON_EXISTENT'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(0);
    expect(json.meta.total).toBe(0);
    expect(json.meta.pages).toBe(0);
  });
});
