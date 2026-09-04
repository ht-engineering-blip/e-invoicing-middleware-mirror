import crypto from "crypto";
import { Elysia } from "elysia";
import { docsConfig } from "../@config";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export const docsAuthMiddleware = (app: Elysia) =>
  app.onBeforeHandle(({ request, set }) => {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    const isDocsPath =
      pathname === "/openapi" ||
      pathname.startsWith("/openapi/") ||
      pathname === "/docs" ||
      pathname.startsWith("/docs/") ||
      pathname === "/v1/docs" ||
      pathname.startsWith("/v1/docs/") ||
      pathname === "/v1/openapi" ||
      pathname.startsWith("/v1/openapi/");

    if (!isDocsPath) {
      return;
    }

    if (!docsConfig.enabled) {
      set.status = 404;
      return {
        success: false,
        error: "API Documentation is disabled in this environment",
        statusCode: 404,
      };
    }

    if (!docsConfig.isProtected) {
      return;
    }

    const expectedPassword = docsConfig.password;
    if (!expectedPassword) {
      return;
    }

    const expectedUsername = docsConfig.username || "admin";

    // 1. Check HTTP Basic Authentication Header
    const authHeader =
      request.headers.get("authorization") ||
      request.headers.get("Authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
      const b64 = authHeader.slice(6).trim();
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf-8");
        const colonIdx = decoded.indexOf(":");
        if (colonIdx !== -1) {
          const user = decoded.slice(0, colonIdx);
          const pass = decoded.slice(colonIdx + 1);

          const isUserValid = safeCompare(user, expectedUsername);
          const isPassValid = safeCompare(pass, expectedPassword);

          if (isUserValid && isPassValid) {
            return;
          }
        }
      } catch {
        // Fall through to unauthorized
      }
    }

    // 2. Check custom headers (e.g. x-docs-password)
    const headerPassword =
      request.headers.get("x-docs-password") ||
      request.headers.get("x-docs-key");
    if (headerPassword && safeCompare(headerPassword, expectedPassword)) {
      return;
    }

    // 3. Check query parameters (e.g. ?password=... or ?key=...)
    const queryPassword =
      url.searchParams.get("password") ||
      url.searchParams.get("key") ||
      url.searchParams.get("token");
    if (queryPassword && safeCompare(queryPassword, expectedPassword)) {
      return;
    }

    // 4. Deny with 401 and prompt for HTTP Basic Auth
    set.status = 401;
    set.headers["WWW-Authenticate"] =
      'Basic realm="Restricted API Documentation", charset="UTF-8"';
    return {
      success: false,
      error: "Unauthorized: Password protected API documentation",
      statusCode: 401,
      message:
        "Please provide valid credentials to access the API documentation",
    };
  });
