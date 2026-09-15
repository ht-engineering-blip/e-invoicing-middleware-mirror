import { Elysia } from "elysia";

/**
 * Security Response Headers Middleware
 * Standard security response headers:
 * - X-Frame-Options: DENY (frame-deny)
 * - X-Content-Type-Options: nosniff (no-sniff)
 * - Referrer-Policy: strict-origin-when-cross-origin (referrer-policy)
 * - Content-Security-Policy: default-src 'self' (minimal CSP)
 */
export const securityHeadersMiddleware = new Elysia({
  name: "security-headers",
}).onRequest(({ request, set }) => {
  set.headers["X-Frame-Options"] = "DENY";
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const isDocs =
    pathname === "/openapi" ||
    pathname.startsWith("/openapi/") ||
    pathname === "/docs" ||
    pathname.startsWith("/docs/") ||
    pathname === "/v1/docs" ||
    pathname.startsWith("/v1/docs/") ||
    pathname === "/swagger" ||
    pathname.startsWith("/swagger/");

  if (isDocs) {
    set.headers["Content-Security-Policy"] =
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com data: blob:;";
  } else {
    set.headers["Content-Security-Policy"] = "default-src 'self'";
  }
});
