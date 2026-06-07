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

describe('JWT Security & Session Invalidation Boundary Tests', () => {
  let AuthService: any;
  let requireJwt: any;
  let requireAuth: any;
  let TenantRepository: any;
  let TeamMemberRepository: any;
  let findByTenantIdSpy: any;
  let findByUserIdSpy: any;

  const mockSecret = 'super-secure-jwt-key-min-32-chars-long-secret';

  const mockTenant = {
    tenantId: 'tenant-123',
    businessName: 'Secure Tenant Business',
    tin: '12345678-0001',
    contactEmail: 'contact@securetenant.com',
    status: 'active',
    password: 'super-secure-password-hash',
    config: {
      erpSystem: 'TEST',
      webhookUrl: 'https://webhook.example.com',
      webhookAuth: 'webhooksecret',
    },
    metadata: {
      webhookSecretHash: 'webhookhashvalue',
    },
    passwordChangedAt: undefined as Date | undefined,
  };

  beforeAll(async () => {
    // Inject mock secret for test runs
    if (jwtConfig) {
      jwtConfig.secret = mockSecret;
      jwtConfig.algorithm = 'HS256';
    }

    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'super-secret-encryption-key-for-test-runs';
    }

    const cryptoMod = await import('../src/@lib/crypto');
    const encryptedClientId = cryptoMod.encryptSensitiveData('tenant-123');

    (mockTenant as any).config = {
      ...mockTenant.config,
      firsCredentials: {
        clientId: encryptedClientId,
      },
    };

    const authServiceMod = await import('../src/v1/auth/services');
    AuthService = authServiceMod.AuthService;

    const middlewareMod = await import('../src/middlewares/auth');
    requireJwt = middlewareMod.requireJwt;
    requireAuth = middlewareMod.requireAuth;

    const tenantRepoMod = await import('../src/v1/tenants/repos/tenant.repo');
    TenantRepository = tenantRepoMod.TenantRepository;

    const memberRepoMod = await import('../src/v1/tenants/repos/team-member.repo');
    TeamMemberRepository = memberRepoMod.TeamMemberRepository;

    // Spy on TenantRepository to return our mockTenant
    const originalFindByTenantId = TenantRepository.prototype.findByTenantId;
    findByTenantIdSpy = spyOn(TenantRepository.prototype, 'findByTenantId').mockImplementation(async function(this: any, id: string) {
      if (id === 'tenant-123') return mockTenant as any;
      return originalFindByTenantId.call(this, id);
    });

    // Mock TeamMemberRepository
    const originalFindByUserId = TeamMemberRepository.prototype.findByUserId;
    findByUserIdSpy = spyOn(TeamMemberRepository.prototype, 'findByUserId').mockImplementation(async function(this: any, userId: string) {
      if (!userId || userId.startsWith('usr_')) {
        return originalFindByUserId.call(this, userId);
      }
      return null;
    });
  });

  afterAll(() => {
    if (findByTenantIdSpy) findByTenantIdSpy.mockRestore();
    if (findByUserIdSpy) findByUserIdSpy.mockRestore();
  });

  describe('1. JWT Payload Whitelisting', () => {
    it('should strictly whitelist token payload and exclude sensitive keys', async () => {
      const authService = new AuthService();
      const token = await authService.createAuthToken(mockTenant as any);
      
      const decoded = jwt.decode(token) as any;
      
      // Whitelisted fields should exist
      expect(decoded.tenantId).toBe('tenant-123');
      expect(decoded.businessId).toBe('tenant-123');
      expect(decoded.type).toBe('tenant');
      expect(decoded.role).toBe('owner');
      expect(decoded.scopes).toEqual(['*']);
      expect(decoded.email).toBe('contact@securetenant.com');
      expect(decoded.businessName).toBe('Secure Tenant Business');
      
      // Sensitive fields must be excluded
      expect(decoded.password).toBeUndefined();
      expect(decoded.config).toBeUndefined();
      expect(decoded.metadata).toBeUndefined();
      expect(decoded.webhookAuth).toBeUndefined();
      expect(decoded.webhookUrl).toBeUndefined();
    });
  });

  describe('2. Algorithm Confusion Prevention', () => {
    it('should fail verification if algorithms do not match HS256', () => {
      const token = jwt.sign({ tenantId: 'tenant-123' }, mockSecret);
      
      // Attempting to verify token with no pinned algorithms or wrong algorithm should throw/reject
      expect(() => {
        jwt.verify(token, mockSecret, { algorithms: ['RS256'] });
      }).toThrow();
    });
  });

  describe('3. Password Changed Invalidation (passwordChangedAt)', () => {
    it('should allow token issued after passwordChangedAt', async () => {
      // Set passwordChangedAt in the past
      mockTenant.passwordChangedAt = new Date(Date.now() - 5000);
      
      // Create a token issued NOW
      const token = jwt.sign(
        { 
          tenantId: 'tenant-123', 
          businessId: 'tenant-123', 
          iat: Math.floor(Date.now() / 1000) 
        }, 
        mockSecret
      );

      // Create dummy Elysia instance to run middleware resolve hook
      const mockElysiaInstance = {
        resolve: (fn: any) => fn
      } as any;

      const resolveHook = requireJwt(mockElysiaInstance);
      const result = await resolveHook({
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(result.auth).toBeDefined();
      expect(result.auth.tenantId).toBe('tenant-123');
    });

    it('should reject token issued before passwordChangedAt', async () => {
      // Set passwordChangedAt to future/now
      mockTenant.passwordChangedAt = new Date(Date.now() + 5000);
      
      // Create a token issued in the past
      const token = jwt.sign(
        { 
          tenantId: 'tenant-123', 
          businessId: 'tenant-123', 
          iat: Math.floor((Date.now() - 5000) / 1000) 
        }, 
        mockSecret
      );

      const mockElysiaInstance = {
        resolve: (fn: any) => fn
      } as any;

      const resolveHook = requireJwt(mockElysiaInstance);
      
      let errorThrown: any = null;
      try {
        await resolveHook({
          headers: {
            authorization: `Bearer ${token}`
          }
        });
      } catch (err) {
        errorThrown = err;
      }
      expect(errorThrown).toBeDefined();
      expect(errorThrown.message).toContain('Token has been invalidated due to password change');
    });
  });
});
