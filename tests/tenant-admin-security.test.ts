import { mock } from 'bun:test';
import path from 'node:path';

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
import * as jwt from 'jsonwebtoken';
import { jwtConfig } from '../src/@config/jwt';
import { appConfig } from '../src/@config/app';

describe('Tenant Admin Routes & Credentials Redaction Security Tests', () => {
  let adminTenantRoutes: any;
  let TenantRepository: any;
  let TeamMemberRepository: any;
  let ApiKeyRepository: any;
  let AuditLogRepository: any;
  let TenantService: any;

  const mockAdminKey = 'super-secret-admin-key';

  const mockTenant = {
    tenantId: 'tenant-123',
    businessName: 'Test Business',
    tin: '12345678-0001',
    status: 'active',
    config: {
      erpSystem: 'TEST',
      erpSyncConfig: {
        name: 'My ERP',
        enabled: true,
        method: 'POST',
        baseUrl: 'https://erp.example.com',
        endpoint: '/sync',
        authentication: {
          type: 'basic',
          username: 'erpuser',
          password: 'encrypted-password-value',
          token: 'encrypted-token-value',
          apiKeyValue: 'encrypted-apikey-value',
        },
      },
    },
  };

  const createToken = (payload: any) => {
    return jwt.sign(payload, jwtConfig?.secret || 'test-secret', {
      algorithm: (jwtConfig?.algorithm as jwt.Algorithm) || 'HS256',
    });
  };

  const adminTokenHeader = { 
    'x-admin-key': mockAdminKey 
  };

  const ownerTokenHeader = {
    Authorization: `Bearer ${createToken({
      type: 'team_member',
      tenantId: 'tenant-123',
      userId: 'user-owner',
      scopes: ['*'],
    })}`,
  };

  const adminMemberTokenHeader = {
    Authorization: `Bearer ${createToken({
      type: 'team_member',
      tenantId: 'tenant-123',
      userId: 'user-admin',
      scopes: ['*'],
    })}`,
  };

  const viewerTokenHeader = {
    Authorization: `Bearer ${createToken({
      type: 'team_member',
      tenantId: 'tenant-123',
      userId: 'user-viewer',
      scopes: ['*'],
    })}`,
  };

  const foreignTenantTokenHeader = {
    Authorization: `Bearer ${createToken({
      type: 'team_member',
      tenantId: 'tenant-other',
      userId: 'user-other',
      scopes: ['*'],
    })}`,
  };

  beforeAll(async () => {
    // Inject mock admin key for authentication middleware
    if (appConfig) {
      appConfig.adminKey = mockAdminKey;
    }

    const tenantServiceMod = await import('../src/v1/tenants/services/tenant.service');
    TenantService = tenantServiceMod.TenantService;

    const routesMod = await import('../src/v1/tenants/routes/admin');
    adminTenantRoutes = routesMod.default;

    const tenantRepoMod = await import('../src/v1/tenants/repos/tenant.repo');
    TenantRepository = tenantRepoMod.TenantRepository;

    const memberRepoMod = await import('../src/v1/tenants/repos/team-member.repo');
    TeamMemberRepository = memberRepoMod.TeamMemberRepository;

    const apiKeyRepoMod = await import('../src/v1/tenants/repos/api-key.repo');
    ApiKeyRepository = apiKeyRepoMod.ApiKeyRepository;

    const auditRepoMod = await import('../src/v1/audit/repos/audit-log.repo');
    AuditLogRepository = auditRepoMod.AuditLogRepository;

    // Spy on TenantService to intercept database-backed method calls
    spyOn(TenantService.prototype, 'getERPSyncConfig').mockImplementation(async (tenantId: string) => {
      if (tenantId === 'tenant-123') {
        return mockTenant.config.erpSyncConfig as any;
      }
      return null;
    });

    spyOn(TenantService.prototype, 'createTenant').mockImplementation(async (body: any) => {
      return { _id: 'new-tenant-id', ...body } as any;
    });

    spyOn(TenantService.prototype, 'listTenants').mockImplementation(async () => {
      return { tenants: [mockTenant], total: 1 } as any;
    });

    spyOn(TenantService.prototype, 'updateOnboarding').mockImplementation(async (tenantId: string, body: any) => {
      return { tenantId, ...body } as any;
    });

    spyOn(TenantService.prototype, 'createApiKey').mockImplementation(async (tenantId: string, body: any) => {
      return {
        apiKey: { _id: 'key-123', tenantId, name: body.name },
        plainKey: 'ht_key_secret_value',
      } as any;
    });

    // Spy on TenantRepository to make sure auth middleware is happy
    spyOn(TenantRepository.prototype, 'findByTenantId').mockImplementation(async (id: string) => {
      if (id === 'tenant-123') return mockTenant as any;
      if (id === 'tenant-other') return { tenantId: 'tenant-other', status: 'active' } as any;
      return null;
    });

    spyOn(TenantRepository.prototype, 'findOne').mockImplementation(async () => mockTenant as any);
    spyOn(TenantRepository.prototype, 'update').mockImplementation(async () => mockTenant as any);

    // Spy on TeamMemberRepository to mock roles for middleware validation
    spyOn(TeamMemberRepository.prototype, 'findByUserId').mockImplementation(async (userId: string) => {
      if (userId === 'user-owner') {
        return { userId, tenantId: 'tenant-123', role: 'owner', status: 'active' } as any;
      }
      if (userId === 'user-admin') {
        return { userId, tenantId: 'tenant-123', role: 'admin', status: 'active' } as any;
      }
      if (userId === 'user-viewer') {
        return { userId, tenantId: 'tenant-123', role: 'viewer', status: 'active' } as any;
      }
      if (userId === 'user-other') {
        return { userId, tenantId: 'tenant-other', role: 'owner', status: 'active' } as any;
      }
      return null;
    });

    // Mock Audit Log creation
    spyOn(AuditLogRepository.prototype, 'create').mockImplementation(async () => ({} as any));
  });

  describe('1. Global Admin Gating (POST /, GET /, PATCH /:tenantId/onboarding)', () => {
    it('should allow global admin with x-admin-key to list all tenants', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/', {
          method: 'GET',
          headers: adminTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should reject standard tenant owners from listing all tenants', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/', {
          method: 'GET',
          headers: ownerTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(403);
      expect(body.error).toContain('Forbidden');
    });

    it('should reject standard tenant owners from modifying onboarding status', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/onboarding', {
          method: 'PATCH',
          headers: {
            ...ownerTokenHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'active' }),
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(403);
    });
  });

  describe('2. Role-Based Access control (onlyTenantAdmin)', () => {
    it('should allow global admin with x-admin-key to create an API key for any tenant', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/api-keys', {
          method: 'POST',
          headers: {
            ...adminTokenHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Admin Test Key' }),
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should allow tenant OWNER to create an API key for their tenant', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/api-keys', {
          method: 'POST',
          headers: {
            ...ownerTokenHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Owner Test Key' }),
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should allow tenant ADMIN to create an API key for their tenant', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/api-keys', {
          method: 'POST',
          headers: {
            ...adminMemberTokenHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Admin Test Key' }),
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should reject tenant VIEWER from creating an API key', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/api-keys', {
          method: 'POST',
          headers: {
            ...viewerTokenHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Viewer Test Key' }),
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(403);
      expect(body.error).toContain('required administrative role');
    });

    it('should reject foreign tenant from creating an API key', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/api-keys', {
          method: 'POST',
          headers: {
            ...foreignTenantTokenHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Foreign Test Key' }),
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(403);
      expect(body.error).toContain('You do not have access');
    });
  });

  describe('3. ERP Sync Credentials Redaction & Access Security', () => {
    it('should redact sensitive credentials as [REDACTED] for tenant OWNER on GET', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/erp-sync', {
          method: 'GET',
          headers: ownerTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      const authBlock = body.data.authentication;
      expect(authBlock.username).toBe('erpuser'); // Non-sensitive
      expect(authBlock.password).toBe('[REDACTED]');
      expect(authBlock.token).toBe('[REDACTED]');
      expect(authBlock.apiKeyValue).toBe('[REDACTED]');
    });

    it('should STILL redact sensitive credentials for tenant OWNER even if passing decrypt=true', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/erp-sync?decrypt=true', {
          method: 'GET',
          headers: ownerTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      const authBlock = body.data.authentication;
      expect(authBlock.password).toBe('[REDACTED]');
      expect(authBlock.token).toBe('[REDACTED]');
    });

    it('should return fully decrypted credentials for global admin on GET by default when decrypt is omitted (backward compatibility)', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/erp-sync', {
          method: 'GET',
          headers: adminTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      const authBlock = body.data.authentication;
      expect(authBlock.password).toBe('encrypted-password-value');
      expect(authBlock.token).toBe('encrypted-token-value');
      expect(authBlock.apiKeyValue).toBe('encrypted-apikey-value');
    });

    it('should return fully decrypted credentials for global admin on GET when explicitly passing decrypt=true', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/erp-sync?decrypt=true', {
          method: 'GET',
          headers: adminTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      const authBlock = body.data.authentication;
      expect(authBlock.password).toBe('encrypted-password-value');
      expect(authBlock.token).toBe('encrypted-token-value');
      expect(authBlock.apiKeyValue).toBe('encrypted-apikey-value');
    });

    it('should redact sensitive credentials for global admin on GET when explicitly passing decrypt=false', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/erp-sync?decrypt=false', {
          method: 'GET',
          headers: adminTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      const authBlock = body.data.authentication;
      expect(authBlock.password).toBe('[REDACTED]');
      expect(authBlock.token).toBe('[REDACTED]');
      expect(authBlock.apiKeyValue).toBe('[REDACTED]');
    });

    it('should reject viewer role from accessing ERP Sync Config', async () => {
      const response = await adminTenantRoutes.handle(
        new Request('http://localhost/tenant-123/erp-sync', {
          method: 'GET',
          headers: viewerTokenHeader,
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(403);
    });
  });
});
