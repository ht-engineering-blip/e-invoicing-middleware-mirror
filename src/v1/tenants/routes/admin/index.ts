import { Elysia } from "elysia";
import { adminTenantCrudRoutes } from "./tenant-crud.routes";
import { adminTenantKeysRoutes } from "./tenant-keys.routes";
import { adminTenantConfigRoutes } from "./tenant-config.routes";

export const adminTenantRoutes = new Elysia()
  .use(adminTenantCrudRoutes)
  .use(adminTenantKeysRoutes)
  .use(adminTenantConfigRoutes);

export {
  adminTenantCrudRoutes,
  adminTenantKeysRoutes,
  adminTenantConfigRoutes,
};
