// Tenant context middleware
import { Elysia } from 'elysia';

export const tenantMiddleware = new Elysia({ name: 'tenant' })
  .resolve(async ({ headers }) => {
    // TODO: Implement tenant context loading
    const tenantId = headers['x-tenant-id'];
    return { tenantId };
  });

