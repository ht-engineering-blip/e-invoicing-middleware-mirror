// Workflow module routes
import { Elysia } from "elysia";
import outboundInvoiceRoutes from "./routes/outbound.routes";
import transformInvoiceRoutes from "./routes/transform.routes";
import { requireAuth } from "../../middlewares";
import inboundInvoiceRoutes from "./routes/inbound.routes";
import { transactionLogsRoutes } from "./routes/transaction-logs.routes";

export const workflowRoutes = new Elysia({
  prefix: "/workflow",
  detail: {
    tags: ["Workflow"],
    security: [{ apiKey: [] }, { bearerToken: [] }],
  },
})
  .use(requireAuth)
  .use(outboundInvoiceRoutes)
  .use(inboundInvoiceRoutes)
  .use(transformInvoiceRoutes)
  .use(transactionLogsRoutes);
