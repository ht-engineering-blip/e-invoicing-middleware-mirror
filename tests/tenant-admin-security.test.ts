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

import { describe, it, expect, spyOn, beforeAll, afterAll } from 'bun:test';
import * as jwt from 'jsonwebtoken';
import { jwtConfig } from '../src/@config/jwt';
import { appConfig } from '../src/@config/app';
const mockAdminKey = 'super-secret-admin-key';
if (appConfig) {
  appConfig.adminKey = mockAdminKey;
}
if (jwtConfig) {
  jwtConfig.secret = 'my-jwt-secret';
}

describe('Tenant Admin Routes & Credentials Redaction Security Tests', () => {
  let adminTenantRoutes: any;
  let TenantRepository: any;
  let TeamMemberRepository: any;
  let ApiKeyRepository: any;
  let AuditLogRepository: any;
  let TenantService: any;
  let getERPSyncConfigSpy: any;
  let createTenantSpy: any;
  let listTenantsSpy: any;
  let updateOnboardingSpy: any;
  let createApiKeySpy: any;
  let findByTenantIdSpy: any;
  let findOneSpy: any;
  let updateSpy: any;
  let findByUserIdSpy: any;
  let createAuditSpy: any;


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
    const routesMod = await import('../src/v1/tenants/routes/admin');
    adminTenantRoutes = routesMod.default;

    const tenantServiceMod = await import('../src/v1/tenants/services/tenant.service');
    TenantService = tenantServiceMod.TenantService;

    const tenantRepoMod = await import('../src/v1/tenants/repos/tenant.repo');
    TenantRepository = tenantRepoMod.TenantRepository;

    const memberRepoMod = await import('../src/v1/tenants/repos/team-member.repo');
    TeamMemberRepository = memberRepoMod.TeamMemberRepository;

    const apiKeyRepoMod = await import('../src/v1/tenants/repos/api-key.repo');
    ApiKeyRepository = apiKeyRepoMod.ApiKeyRepository;

    const auditRepoMod = await import('../src/v1/audit/repos/audit-log.repo');
    AuditLogRepository = auditRepoMod.AuditLogRepository;

    // Spy on TenantService to intercept database-backed method calls
    const originalGetERPSyncConfig = TenantService.prototype.getERPSyncConfig;
    getERPSyncConfigSpy = spyOn(TenantService.prototype, 'getERPSyncConfig').mockImplementation(async function(this: any, tenantId: string) {
      if (tenantId === 'tenant-123') {
        return mockTenant.config.erpSyncConfig as any;
      }
      return originalGetERPSyncConfig.call(this, tenantId);
    });

    const originalCreateTenant = TenantService.prototype.createTenant;
    createTenantSpy = spyOn(TenantService.prototype, 'createTenant').mockImplementation(async function(this: any, body: any, actor?: any) {
      if (body?.businessName === 'Test Business' || body?.tenantId === 'tenant-123') {
        return { _id: 'new-tenant-id', ...body } as any;
      }
      return originalCreateTenant.call(this, body, actor);
    });

    const originalListTenants = TenantService.prototype.listTenants;
    listTenantsSpy = spyOn(TenantService.prototype, 'listTenants').mockImplementation(async function(this: any, filters?: any) {
      if (filters?.tenantId && filters.tenantId !== 'tenant-123' && filters.tenantId !== 'tenant-other') {
        return originalListTenants.call(this, filters);
      }
      return { tenants: [mockTenant], total: 1 } as any;
    });

    const originalUpdateOnboarding = TenantService.prototype.updateOnboarding;
    updateOnboardingSpy = spyOn(TenantService.prototype, 'updateOnboarding').mockImplementation(async function(this: any, tenantId: string, body: any, actor?: any) {
      if (tenantId === 'tenant-123') {
        return { tenantId, ...body } as any;
      }
      return originalUpdateOnboarding.call(this, tenantId, body, actor);
    });

    const originalCreateApiKey = TenantService.prototype.createApiKey;
    createApiKeySpy = spyOn(TenantService.prototype, 'createApiKey').mockImplementation(async function(this: any, tenantId: string, body: any, actor?: any) {
      if (tenantId === 'tenant-123') {
        return {
          apiKey: { _id: 'key-123', tenantId, name: body.name },
          plainKey: 'ht_key_secret_value',
        } as any;
      }
      return originalCreateApiKey.call(this, tenantId, body, actor);
    });

    // Spy on TenantRepository to make sure auth middleware is happy
    const originalFindByTenantId = TenantRepository.prototype.findByTenantId;
    findByTenantIdSpy = spyOn(TenantRepository.prototype, 'findByTenantId').mockImplementation(async function(this: any, id: string) {
      if (id === 'tenant-123') return mockTenant as any;
      if (id === 'tenant-other') return { tenantId: 'tenant-other', status: 'active' } as any;
      return originalFindByTenantId.call(this, id);
    });

    const originalFindOne = TenantRepository.prototype.findOne;
    findOneSpy = spyOn(TenantRepository.prototype, 'findOne').mockImplementation(async function(this: any, query: any, ...args: any[]) {
      if (query?.tenantId?._eq === 'tenant-123' || query?.tenantId?._eq === 'tenant-other') {
        return mockTenant as any;
      }
      return originalFindOne.call(this, query, ...args);
    });

    const originalUpdate = TenantRepository.prototype.update;
    updateSpy = spyOn(TenantRepository.prototype, 'update').mockImplementation(async function(this: any, tenantId: string, data: any) {
      if (tenantId === 'tenant-123' || tenantId === 'tenant-other') {
        return mockTenant as any;
      }
      return originalUpdate.call(this, tenantId, data);
    });

    // Spy on TeamMemberRepository to mock roles for middleware validation
    const originalFindByUserId = TeamMemberRepository.prototype.findByUserId;
    findByUserIdSpy = spyOn(TeamMemberRepository.prototype, 'findByUserId').mockImplementation(async function(this: any, userId: string) {
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
      return originalFindByUserId.call(this, userId);
    });

    // Mock Audit Log creation
    const originalCreateAudit = AuditLogRepository.prototype.create;
    createAuditSpy = spyOn(AuditLogRepository.prototype, 'create').mockImplementation(async function(this: any, data: any) {
      if (data?.tenantId === 'tenant-123' || data?.tenantId === 'tenant-other') {
        return {} as any;
      }
      return originalCreateAudit.call(this, data);
    });
  });

  afterAll(() => {
    if (getERPSyncConfigSpy) getERPSyncConfigSpy.mockRestore();
    if (createTenantSpy) createTenantSpy.mockRestore();
    if (listTenantsSpy) listTenantsSpy.mockRestore();
    if (updateOnboardingSpy) updateOnboardingSpy.mockRestore();
    if (createApiKeySpy) createApiKeySpy.mockRestore();
    if (findByTenantIdSpy) findByTenantIdSpy.mockRestore();
    if (findOneSpy) findOneSpy.mockRestore();
    if (updateSpy) updateSpy.mockRestore();
    if (findByUserIdSpy) findByUserIdSpy.mockRestore();
    if (createAuditSpy) createAuditSpy.mockRestore();
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
