import { Elysia } from "elysia";
import { authLoginRoutes } from "./login.routes";
import { authPasswordRoutes } from "./password.routes";
import { authSessionRoutes } from "./session.routes";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authLoginRoutes)
  .use(authPasswordRoutes)
  .use(authSessionRoutes);

export { authLoginRoutes, authPasswordRoutes, authSessionRoutes };
