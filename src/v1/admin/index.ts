import { Elysia } from 'elysia';
import { firsConfigRoutes } from './routes/firs-config.routes';
import { erpConfigRoutes } from './routes/erp-config.routes';
import { sandboxRoutes } from './routes/sandbox.routes';
import { referenceRoutes } from './routes/reference.routes';

/**
 * Admin Module Routes
 * All routes require admin authentication via x-admin-key header
 */
export const adminModuleRoutes = new Elysia({ prefix: '/admin' })
  .use(firsConfigRoutes)
  .use(erpConfigRoutes)
  .use(sandboxRoutes)
  .use(referenceRoutes);

// Export models and services for use elsewhere
export * from './models';
export { SystemConfigService } from './services/system-config.service';
