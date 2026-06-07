import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { TenantRepository } from "../src/v1/tenants/repos/tenant.repo";
import { rateLimitMiddleware } from "../src/middlewares/rate-limit";

describe("Rate Limiting Middleware", () => {
  let findByTenantIdSpy: any;

  beforeAll(() => {
    findByTenantIdSpy = spyOn(TenantRepository.prototype, "findByTenantId").mockImplementation(async (tenantId: string) => {
      if (tenantId === "custom-limit-tenant") {
        return {
          tenantId: "custom-limit-tenant",
          config: {
            limits: {
              apiRateLimit: 15,
            },
          },
        } as any;
      }
      if (tenantId === "low-limit-tenant") {
        return {
          tenantId: "low-limit-tenant",
          config: {
            limits: {
              apiRateLimit: 2,
            },
          },
        } as any;
      }
      return null;
    });
  });

  afterAll(() => {
    if (findByTenantIdSpy) findByTenantIdSpy.mockRestore();
  });

  it("should set correct headers on successful request", async () => {
    const app = new Elysia()
      .use(rateLimitMiddleware)
      .get("/test", () => ({ success: true }));

    const res = await app.handle(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("59");
    expect(res.headers.get("X-RateLimit-Reset")).not.toBeNull();
  });

  it("should enforce IP rate limit fallback (60 req/min)", async () => {
    const app = new Elysia()
      .use(rateLimitMiddleware)
      .get("/test", () => ({ success: true }));

    const ip = "5.6.7.8";

    // Hit the endpoint 60 times
    for (let i = 0; i < 60; i++) {
      const res = await app.handle(
        new Request("http://localhost/test", {
          headers: { "x-forwarded-for": ip },
        })
      );
      expect(res.status).toBe(200);
    }

    // 61st hit should fail
    const res = await app.handle(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": ip },
      })
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("Retry-After")).toBe("60");

    const data = await res.json() as any;
    expect(data.success).toBe(false);
    expect(data.error).toBe("Too Many Requests");
  });

  it("should resolve and enforce tenant-specific rate limit from DB (low-limit-tenant limit of 2)", async () => {
    const app = new Elysia()
      .use(rateLimitMiddleware)
      .get("/test", () => ({ success: true }));

    // Request 1: success
    const res1 = await app.handle(
      new Request("http://localhost/test", {
        headers: { "x-tenant-id": "low-limit-tenant" },
      })
    );
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("1");

    // Request 2: success
    const res2 = await app.handle(
      new Request("http://localhost/test", {
        headers: { "x-tenant-id": "low-limit-tenant" },
      })
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("0");

    // Request 3: blocked
    const res3 = await app.handle(
      new Request("http://localhost/test", {
        headers: { "x-tenant-id": "low-limit-tenant" },
      })
    );
    expect(res3.status).toBe(429);
    expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res3.headers.get("Retry-After")).toBe("60");
  });

  it("should respect auth tenantId from auth context (custom-limit-tenant limit of 15)", async () => {
    const app = new Elysia()
      .resolve(() => {
        return {
          auth: {
            tenantId: "custom-limit-tenant",
          },
        };
      })
      .use(rateLimitMiddleware)
      .get("/test", () => ({ success: true }));

    // Request 1: success
    const res = await app.handle(new Request("http://localhost/test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("15");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("14");
  });

  it("should fall back to default tenant limit (100) if tenant config is missing limits", async () => {
    const app = new Elysia()
      .use(rateLimitMiddleware)
      .get("/test", () => ({ success: true }));

    const res = await app.handle(
      new Request("http://localhost/test", {
        headers: { "x-tenant-id": "unknown-tenant" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
  });
});
