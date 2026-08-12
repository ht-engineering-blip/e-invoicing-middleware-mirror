// Workflow module routes
import { Elysia } from "elysia";
import { requireAuth } from "../../middlewares";

import invoiceMgmtRoutes from "./routes/invoices.routes";

export const invoicingRoutes = new Elysia({
  prefix: "/invoicing",
  detail: {
    security: [{ apiKey: [] }, { bearerToken: [] }],
  },
})
  .use(requireAuth)
  .use(invoiceMgmtRoutes);
