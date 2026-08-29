/**
 * Auth Module Root Router & Exports
 */
import { authRoutes } from "./routes";

export const authModuleRoutes = authRoutes;
export { authRoutes };
export * from "./services";
export * from "./models";
export * from "./repos";
export * from "./validations/auth.validation";
