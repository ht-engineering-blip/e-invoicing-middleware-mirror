import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { docsAuthMiddleware } from "../src/middlewares/docs-auth.middleware";
import { docsConfig } from "../src/@config/docs";

describe("Password-Protected OpenAPI Documentation Tests", () => {
  let originalPassword: string | undefined;
  let originalProtected: boolean;
  let originalEnabled: boolean;
  let originalUsername: string;

  beforeAll(() => {
    originalPassword = docsConfig.password;
    originalProtected = docsConfig.isProtected;
    originalEnabled = docsConfig.enabled;
    originalUsername = docsConfig.username;
  });

  afterAll(() => {
    docsConfig.password = originalPassword;
    docsConfig.isProtected = originalProtected;
    docsConfig.enabled = originalEnabled;
    docsConfig.username = originalUsername;
  });

  it("should allow unrestricted access to /openapi when protection is disabled", async () => {
    docsConfig.enabled = true;
    docsConfig.isProtected = false;
    docsConfig.password = undefined;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const res = await app.handle(new Request("http://localhost/openapi"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("OpenAPI Documentation HTML");
  });

  const testDocsPassword = process.env.DOCS_PASSWORD || "test-docs-pass";

  it("should reject unauthenticated request to /openapi with 401 and WWW-Authenticate header when docs are protected", async () => {
    docsConfig.enabled = true;
    docsConfig.isProtected = true;
    docsConfig.username = "admin";
    docsConfig.password = testDocsPassword;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const res = await app.handle(new Request("http://localhost/openapi"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic realm=");
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(401);
    expect(body.error).toContain("Password protected");
  });

  it("should reject invalid Basic Auth credentials with 401", async () => {
    docsConfig.enabled = true;
    docsConfig.isProtected = true;
    docsConfig.username = "admin";
    docsConfig.password = testDocsPassword;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const invalidAuth = Buffer.from("admin:WrongPassword").toString("base64");
    const res = await app.handle(
      new Request("http://localhost/openapi", {
        headers: {
          authorization: `Basic ${invalidAuth}`,
        },
      }),
    );

    expect(res.status).toBe(401);
  });

  it("should allow access with valid HTTP Basic Auth credentials", async () => {
    docsConfig.enabled = true;
    docsConfig.isProtected = true;
    docsConfig.username = "admin";
    docsConfig.password = testDocsPassword;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const validAuth = Buffer.from(`admin:${testDocsPassword}`).toString("base64");
    const res = await app.handle(
      new Request("http://localhost/openapi", {
        headers: {
          authorization: `Basic ${validAuth}`,
        },
      }),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("OpenAPI Documentation HTML");
  });

  it("should allow access with valid x-docs-password header", async () => {
    docsConfig.enabled = true;
    docsConfig.isProtected = true;
    docsConfig.username = "admin";
    docsConfig.password = testDocsPassword;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const res = await app.handle(
      new Request("http://localhost/openapi", {
        headers: {
          "x-docs-password": testDocsPassword,
        },
      }),
    );

    expect(res.status).toBe(200);
  });

  it("should allow access with valid ?password query parameter", async () => {
    docsConfig.enabled = true;
    docsConfig.isProtected = true;
    docsConfig.username = "admin";
    docsConfig.password = testDocsPassword;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const res = await app.handle(
      new Request(`http://localhost/openapi?password=${encodeURIComponent(testDocsPassword)}`),
    );

    expect(res.status).toBe(200);
  });

  it("should return 404 when docs are completely disabled via DOCS_ENABLED=false", async () => {
    docsConfig.enabled = false;
    docsConfig.isProtected = false;

    const app = new Elysia()
      .use(docsAuthMiddleware)
      .get("/openapi", () => "OpenAPI Documentation HTML");

    const res = await app.handle(new Request("http://localhost/openapi"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("disabled");
  });
});
