import {
  describe,
  it,
  expect,
  mock,
  spyOn,
  beforeAll,
  afterAll,
} from "bun:test";
import * as jwt from "jsonwebtoken";
import { Elysia } from "elysia";

// Suppress Mongo backend in tests
mock.module("@agendajs/mongo-backend", () => {
  return {
    MongoBackend: class {
      connect = async () => this;
      database = async () => ({
        collection: () => ({
          findOne: () => Promise.resolve(null),
          find: () => ({ toArray: () => Promise.resolve([]) }),
          insertOne: () => Promise.resolve({}),
          updateOne: () => Promise.resolve({}),
          createIndex: () => Promise.resolve({}),
        }),
      });
    },
  };
});

mock.module("../src/@lib/queue/agenda", () => ({
  agenda: {
    define: () => {},
    on: () => {},
    start: async () => {},
    schedule: async () => {},
  },
}));

import { jwtConfig } from "../src/@config/jwt";
import { publicOnboardingRoutes } from "../src/v1/tenants/routes/onboarding.routes";
import { TenantService } from "../src/v1/tenants/services/tenant.service";
import { AuthService } from "../src/v1/auth/services";
import { TenantRepository } from "../src/v1/tenants/repos/tenant.repo";

describe("Onboarding Activation Token Lifecycle", () => {
  const mockSecret = "super-secure-jwt-key-min-32-chars-long-secret";
  let mockTenant: any;

  let findByTenantIdSpy: any;
  let findOneSpy: any;
  let updateSpy: any;
  let notifyTenantSpy: any;

  beforeAll(() => {
    if (jwtConfig) {
      jwtConfig.secret = mockSecret;
      jwtConfig.algorithm = "HS256";
    }

    mockTenant = {
      tenantId: "test-tenant-123",
      businessName: "Activation Test Biz",
      contactEmail: "activate@test.com",
      password: "",
      metadata: {
        activationTokenId: "initial-uuid",
        activationTokenExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours from now
      },
      toObject() {
        return this;
      },
    };

    // Spy on TenantRepository methods to return mockTenant
    const originalFindByTenantId = TenantRepository.prototype.findByTenantId;
    findByTenantIdSpy = spyOn(
      TenantRepository.prototype,
      "findByTenantId",
    ).mockImplementation(async function (this: any, id: string) {
      if (id === "test-tenant-123") return mockTenant;
      return originalFindByTenantId.call(this, id);
    });

    const originalFindOne = TenantRepository.prototype.findOne;
    findOneSpy = spyOn(
      TenantRepository.prototype,
      "findOne",
    ).mockImplementation(async function (
      this: any,
      query: any,
      ...args: any[]
    ) {
      if (query?.tenantId?._eq === "test-tenant-123") return mockTenant;
      return originalFindOne.call(this, query, ...args);
    });

    const originalUpdate = TenantRepository.prototype.update;
    updateSpy = spyOn(TenantRepository.prototype, "update").mockImplementation(
      async function (this: any, id: string, data: any) {
        if (id === "test-tenant-123") {
          mockTenant = { ...mockTenant, ...data };
          return mockTenant;
        }
        return originalUpdate.call(this, id, data);
      },
    );

    // Mock notifyTenant to not send emails
    const originalNotifyTenant = TenantService.prototype.notifyTenant;
    notifyTenantSpy = spyOn(
      TenantService.prototype,
      "notifyTenant",
    ).mockImplementation(async function (this: any, mail: any, tenant: any) {
      if (tenant?.tenantId === "test-tenant-123") return true;
      return originalNotifyTenant.call(this, mail, tenant);
    });
  });

  afterAll(() => {
    if (findByTenantIdSpy) findByTenantIdSpy.mockRestore();
    if (findOneSpy) findOneSpy.mockRestore();
    if (updateSpy) updateSpy.mockRestore();
    if (notifyTenantSpy) notifyTenantSpy.mockRestore();
  });

  it("should include activationTokenId in JWT token signed by createAuthToken", async () => {
    const authService = new AuthService();
    const token = await authService.createAuthToken(mockTenant);
    const decoded = jwt.verify(token, mockSecret) as any;

    expect(decoded.tenantId).toBe("test-tenant-123");
    expect(decoded.activationTokenId).toBe("initial-uuid");
  });

  it("should successfully validate a matching, unexpired activation token", async () => {
    const authService = new AuthService();
    const token = await authService.createAuthToken(mockTenant);

    const app = new Elysia().use(publicOnboardingRoutes);
    const response = await app.handle(
      new Request(`http://localhost/activate/${token}`),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe("test-tenant-123");
    expect(body.data.setPasswordToken).toBeDefined();
  });

  it("should reject activation if the activationTokenId in the JWT does not match the database (e.g. because it was disabled/replaced)", async () => {
    const authService = new AuthService();
    const token = await authService.createAuthToken(mockTenant);

    // Simulate invalidation/disable by modifying the DB's token ID
    mockTenant.metadata.activationTokenId = "new-regenerated-uuid";

    const app = new Elysia().use(publicOnboardingRoutes);
    const response = await app.handle(
      new Request(`http://localhost/activate/${token}`),
    );

    expect(response.status).toBe(400); // Route catches error and returns success: false with 400 status
    const body = (await response.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid or expired activation link");
  });

  it("should reject activation if the activation token timeframe has expired", async () => {
    // Re-synchronize token IDs, but set expiration in the past
    mockTenant.metadata.activationTokenId = "expired-uuid";
    mockTenant.metadata.activationTokenExpiresAt = new Date(Date.now() - 5000); // Expired 5 seconds ago

    const authService = new AuthService();
    const token = await authService.createAuthToken(mockTenant);

    const app = new Elysia().use(publicOnboardingRoutes);
    const response = await app.handle(
      new Request(`http://localhost/activate/${token}`),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid or expired activation link");
  });

  describe("TenantService Activation Token Helpers", () => {
    let tenantService: TenantService;

    beforeAll(() => {
      tenantService = new TenantService();
    });

    it("should correctly parse activation token expiry without ternary operators", () => {
      const mockObj = {
        metadata: {
          activationTokenExpiresAt: "2026-06-07T12:00:00.000Z",
        },
      };
      const expiry = tenantService.getActivationTokenExpiry(mockObj);
      expect(expiry).toBeInstanceOf(Date);
      expect(expiry?.toISOString()).toBe("2026-06-07T12:00:00.000Z");

      expect(tenantService.getActivationTokenExpiry(null)).toBeNull();
      expect(tenantService.getActivationTokenExpiry({})).toBeNull();
      expect(
        tenantService.getActivationTokenExpiry({ metadata: {} }),
      ).toBeNull();
    });

    it("should correctly validate activation token", () => {
      const validTenant = {
        metadata: {
          activationTokenId: "token-123",
          activationTokenExpiresAt: new Date(Date.now() + 10000).toISOString(),
        },
      };

      expect(
        tenantService.isActivationTokenValid(validTenant, "token-123"),
      ).toBe(true);
      expect(
        tenantService.isActivationTokenValid(validTenant, "wrong-token"),
      ).toBe(false);

      const expiredTenant = {
        metadata: {
          activationTokenId: "token-123",
          activationTokenExpiresAt: new Date(Date.now() - 10000).toISOString(),
        },
      };
      expect(
        tenantService.isActivationTokenValid(expiredTenant, "token-123"),
      ).toBe(false);
      expect(tenantService.isActivationTokenValid(null, "token-123")).toBe(
        false,
      );
    });

    it("should correctly verify token timeframe", () => {
      const activeTenant = {
        metadata: {
          activationTokenId: "token-123",
          activationTokenExpiresAt: new Date(Date.now() + 10000).toISOString(),
        },
      };
      expect(tenantService.isActivationTokenInTimeframe(activeTenant)).toBe(
        true,
      );

      const expiredTenant = {
        metadata: {
          activationTokenId: "token-123",
          activationTokenExpiresAt: new Date(Date.now() - 10000).toISOString(),
        },
      };
      expect(tenantService.isActivationTokenInTimeframe(expiredTenant)).toBe(
        false,
      );
      expect(tenantService.isActivationTokenInTimeframe(null)).toBe(false);
    });
  });
});
