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
}).onRequest(({ set }) => {
  set.headers["X-Frame-Options"] = "DENY";
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  set.headers["Content-Security-Policy"] = "default-src 'self'";
});
